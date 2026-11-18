import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourcesForIdea } from "../research/idea-sources.ts";
import { committedUsd, emptyState, PHASE_TTL_MS, refresh, RESERVE_USD, settlePhase, startAttempt, startCreative, type UsageConfig } from "../usage/policy.ts";
import { Director, FakeTools, ScriptedModel, toolUse, type WorldPage } from "./fakes.ts";
import { FRESH_QUOTE, FRESH_URL, NOW } from "./fixtures.ts";
import { AGENT_LIMITS, Governor } from "./governor.ts";
import { runAgent } from "./loop.ts";
import { toSpark } from "./spark.ts";
import type { Brief } from "./workspace.ts";

const BRIEF: Brief = { brand: "Acme Coffee", platform: "tiktok", audience: "Night-shift nurses", recentIdeas: [] };
const now = () => NOW;
const FRESH: WorldPage = { results: [{ url: FRESH_URL, title: "Desk resets", pageAge: null }], citations: [{ url: FRESH_URL, citedText: FRESH_QUOTE }] };
const map = (run: Awaited<ReturnType<typeof runAgent>>) => toSpark(run, { stamp: 1, now: NOW });

describe("the agent's result, in the page's format", () => {
  it("names a leader the page can find among the candidates and evaluations", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH }), now });
    const spark = map(run);
    const { leaderId } = spark.evaluation;
    assert.ok(leaderId);
    assert.equal(spark.evaluation.evaluations[0].candidateId, leaderId, "the winner is listed first");
    assert.ok(spark.candidates.some((c) => c.id === leaderId));
    assert.equal(spark.finalCandidate?.id, run.winnerId);
    assert.equal(spark.audience, "Night-shift nurses");
    assert.equal(spark.longlist?.ideas.length, 10);
    assert.equal(spark.longlist?.ideas.filter((i) => i.pick).length, 3);
    assert.equal(spark.agent?.how, "finished");
  });

  it("shows only sources the searches returned, with the research cost kept separate", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH }), now });
    const spark = map(run);
    assert.equal(spark.research.status, "verified");
    if (spark.research.status !== "verified") return;
    const links = sourcesForIdea(spark.finalCandidate!, spark.research.ledger);
    assert.deepEqual(links.map((l) => l.url), [FRESH_URL]);
    const usage = spark.research.ledger.researchUsage!;
    assert.equal(usage.webSearches, 2);
    assert.ok(spark.generation.calls.every((c) => c.step !== "search"));
    const total = spark.generation.estimatedCostUsd + usage.estimatedCostUsd;
    assert.ok(Math.abs(total - run.snapshot.spentUsd) < 1e-3, "the footer adds up to what the governor recorded");
  });

  it("presents a kept revision the way the page expects", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"], revise: true }).asModel(), tools: new FakeTools({}, { scoreFor: () => 3, rescoreScore: 5 }), now });
    const spark = map(run);
    assert.equal(spark.refinement.status, "complete");
    if (spark.refinement.status !== "complete") return;
    assert.equal(spark.refinement.decision.outcome, "kept-revised");
    assert.equal(spark.refinement.originalId, spark.evaluation.leaderId);
    assert.equal(spark.finalCandidate?.id, `${spark.evaluation.leaderId}-rev`);
    assert.equal(spark.refinement.critique.affectedCriterion, "stopPower");
    assert.match(spark.refinement.critique.decisionReason, /hook/);
  });

  it("an abstention has no recommendation and says why", async () => {
    const run = await runAgent({ brief: BRIEF, model: new ScriptedModel(() => [toolUse("abstain", { reason: "Nothing makeable this week." })]), tools: new FakeTools({}), now });
    const spark = map(run);
    assert.equal(spark.finalCandidate, null);
    assert.equal(spark.evaluation.leaderId, null);
    assert.equal(spark.candidates.length, 0);
    assert.equal(spark.research.status, "unavailable");
    assert.equal(spark.agent?.endReason, "Nothing makeable this week.");
  });

  it("a run stopped by the budget is labeled as stopped, with its reason", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH }), governor: new Governor({ ceilingUsd: 0.12, wrapUpUsd: 0.1 }), now });
    const spark = map(run);
    assert.equal(spark.agent?.how, "stopped");
    assert.equal(spark.agent?.stopReason, "budget");
    assert.ok(spark.agent!.spentUsd <= 0.12 + 1e-9);
  });
});

describe("usage gate: the agent phase", () => {
  const CONFIG: UsageConfig = { dailyAttempts: 3, networkDailyAttempts: 6, budgetUsd: 27, cycleResetDay: 13 };
  const T0 = Date.UTC(2026, 10, 18, 15);
  const start = (state = emptyState(T0, CONFIG), id = "a1") => {
    const r = startAttempt(state, { id, visitor: "v1", network: "n1", withResearch: false, agent: true, now: T0 }, CONFIG);
    return { state, r };
  };

  it("holds exactly the agent's per-scan ceiling", () => {
    assert.equal(RESERVE_USD.agent, AGENT_LIMITS.ceilingUsd);
    const { state, r } = start();
    assert.ok(r.ok);
    assert.equal(committedUsd(state), 0.75);
  });

  it("uses one of the visitor's daily scans and blocks a second at the same time", () => {
    const { state } = start();
    assert.equal(state.visitors.v1, 1);
    const again = startAttempt(state, { id: "a2", visitor: "v1", network: "n1", withResearch: false, agent: true, now: T0 }, CONFIG);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.kind, "busy");
  });

  it("can't be continued as if it were research", () => {
    const { state } = start();
    const r = startCreative(state, { attemptId: "a1", visitor: "v1", now: T0 }, CONFIG);
    assert.equal(r.ok, false);
  });

  it("swaps the hold for the measured cost", () => {
    const { state } = start();
    settlePhase(state, { attemptId: "a1", costUsd: 0.41, continues: false, now: T0 + 60_000 }, CONFIG);
    assert.equal(committedUsd(state), 0.41);
    assert.equal(state.attempts.a1.stage, "done");
  });

  it("charges an abandoned agent scan its full hold", () => {
    const { state } = start();
    refresh(state, T0 + PHASE_TTL_MS + 1, CONFIG);
    assert.equal(state.cycle.spentUsd, 0.75);
  });

  it("is refused when the shared budget can't cover the hold", () => {
    const state = emptyState(T0, CONFIG);
    state.cycle.spentUsd = 26.5;
    const r = startAttempt(state, { id: "a1", visitor: "v1", network: "n1", withResearch: false, agent: true, now: T0 }, CONFIG);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.kind, "budget");
  });
});

describe("the revision decision on the page", () => {
  it("quotes the agent's reason when it didn't revise", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH }), now });
    const spark = toSpark(run, { stamp: 1, now: NOW });
    assert.equal(spark.refinement.status, "skipped");
    if (spark.refinement.status === "skipped") assert.match(spark.refinement.reason, /In its words: “No revision: the leader has no criterion at 3 or below\.”/);
    assert.equal(spark.agent?.revisionDecision, "No revision: the leader has no criterion at 3 or below.");
  });
});

describe("hypotheses on the page", () => {
  it("carries the agent's bets and their status into the report", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1 ? [toolUse("hypothesize", { why: "Steer.", hypotheses: ["Desk resets are live"] })] : [toolUse("abstain", { reason: "Stop." })],
    );
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    const spark = toSpark(run, { stamp: 1, now: NOW });
    assert.deepEqual(spark.agent?.hypotheses, [{ id: "H1", statement: "Desk resets are live", status: "open", evidence: [], note: "" }]);
  });
});
