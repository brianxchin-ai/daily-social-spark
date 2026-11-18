import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourcesForIdea } from "../research/idea-sources.ts";
import { Director, FakeTools, ScriptedModel, timeoutFailure, toolUse, type WorldPage } from "./fakes.ts";
import { FRESH_QUOTE, FRESH_URL, NOW, STALE_QUOTE, STALE_URL, longlistIdeas } from "./fixtures.ts";
import { AGENT_LIMITS, Governor } from "./governor.ts";
import { CallFailure, runAgent, toolSpecs, type AgentRun } from "./loop.ts";
import type { Brief } from "./workspace.ts";

const BRIEF: Brief = { brand: "Acme Coffee", platform: "tiktok", recentIdeas: [] };
const now = () => NOW;

const FRESH_PAGE: WorldPage = {
  results: [{ url: FRESH_URL, title: "Students turn desk resets into a ritual", pageAge: null }],
  citations: [{ url: FRESH_URL, citedText: FRESH_QUOTE }],
};
const STALE_PAGE: WorldPage = {
  results: [{ url: STALE_URL, title: "The year of latte-art fails", pageAge: null }],
  citations: [{ url: STALE_URL, citedText: STALE_QUOTE }],
};
const SECOND_FRESH_URL = "https://culture.example.com/exam-rituals";
const SECOND_FRESH: WorldPage = {
  results: [{ url: SECOND_FRESH_URL, title: "Exam rituals go public", pageAge: null }],
  citations: [{ url: SECOND_FRESH_URL, citedText: "By November 12, 2026, 'study with me' resets had spread to campus accounts." }],
};

const actors = (run: AgentRun) => run.steps.map((s) => s.actor);
const count = (run: AgentRun, actor: string) => run.steps.filter((s) => s.actor === actor).length;

describe("tool specs", () => {
  it("describes every tool to the API with a JSON schema", () => {
    const specs = toolSpecs();
    assert.equal(specs.length, 13);
    for (const s of specs) {
      assert.equal(s.input_schema.type, "object", s.name);
      assert.equal("$schema" in s.input_schema, false);
    }
  });
});

describe("different circumstances, different paths", () => {
  it("strong evidence: searches, files, builds on the fresh trend and finishes", async () => {
    const tools = new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH });
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset rituals", "exam season habits"] }).asModel(), tools, now });
    assert.equal(run.ending.how, "finished");
    assert.ok(run.winnerId);
    assert.equal(count(run, "web_search"), 2);
    const winner = run.workspace.developed.get(run.winnerId!)!;
    assert.equal(winner.candidate.basis, "trend");
    assert.equal(run.stopReason, null);
  });

  it("weak evidence: notices nothing is fresh, searches again, then falls back to original formats", async () => {
    const tools = new FakeTools({ latte: STALE_PAGE, foam: STALE_PAGE });
    const director = new Director({ queries: ["latte art fails", "coffee foam memes"], fallbackQueries: ["coffee ritual this week"] });
    const run = await runAgent({ brief: BRIEF, model: director.asModel(), tools, now });
    assert.equal(run.ending.how, "finished");
    assert.equal(count(run, "web_search"), 3, "one extra, targeted search after the review found nothing fresh");
    const review = run.steps.find((s) => s.actor === "review_evidence")!;
    assert.match(review.result, /No fresh signal/);
    for (const d of run.workspace.finalists()) assert.equal(d!.candidate.basis, "original");
  });

  it("the two briefs took different action sequences", async () => {
    const strong = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset rituals", "exam season habits"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH }), now });
    const weak = await runAgent({
      brief: BRIEF,
      model: new Director({ queries: ["latte art fails", "coffee foam memes"], fallbackQueries: ["coffee ritual this week"] }).asModel(),
      tools: new FakeTools({ latte: STALE_PAGE, foam: STALE_PAGE }),
      now,
    });
    assert.notDeepEqual(actors(strong), actors(weak));
  });

  it("replaces a pick that code flags as a stale trend", async () => {
    const tools = new FakeTools({ "desk reset": FRESH_PAGE, latte: STALE_PAGE });
    // G1 is fresh (desk resets), G2 is stale (latte art). L2 is grounded in G2 on purpose.
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset rituals", "latte art fails"], riskySignal: "G2" }).asModel(), tools, now });
    const pivot = run.steps.find((s) => s.changedCourse?.startsWith("Dropped L2"));
    assert.ok(pivot, "the trace records the change of course");
    assert.match(pivot!.statedReason!, /stale trend/);
    assert.ok(!run.workspace.picks.some((p) => p.ideaId === "L2"));
    assert.equal(run.ending.how, "finished");
  });
});

describe("finishing and judging", () => {
  it("refuses an early finish, and the agent carries on", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"], finishEarly: true }).asModel(), tools: new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH }), now });
    const early = run.steps.find((s) => s.actor === "finish" && !s.ok);
    assert.ok(early);
    assert.match(early!.result, /Not ready to finish/);
    assert.equal(run.ending.how, "finished");
  });

  it("decides an exact tie by the agent's labeled judgment", async () => {
    const run = await runAgent({
      brief: BRIEF,
      model: new Director({ queries: ["latte", "foam"], tieNote: "Its first frame is stranger." }).asModel(),
      tools: new FakeTools({ latte: STALE_PAGE }, { scoreFor: () => 4 }),
      now,
    });
    assert.ok(run.ending.tieJudgment);
    assert.equal(run.ending.tieJudgment!.note, "Its first frame is stranger.");
    assert.equal(run.winnerId, run.ending.tieJudgment!.chosenId);
  });

  it("keeps a revision only when it clears code's rule", async () => {
    const better = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"], revise: true }).asModel(), tools: new FakeTools({}, { scoreFor: () => 3, rescoreScore: 5 }), now });
    assert.match(better.steps.find((s) => s.actor === "revise")!.result, /Revision kept/);
    assert.match(better.winnerId!, /-rev$/);

    const worse = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"], revise: true }).asModel(), tools: new FakeTools({}, { scoreFor: () => 4, rescoreScore: 4 }), now });
    assert.match(worse.steps.find((s) => s.actor === "revise")!.result, /Revision not kept/);
    assert.doesNotMatch(worse.winnerId!, /-rev$/);
  });

  it("abstains when every finalist is rejected", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"] }).asModel(), tools: new FakeTools({}, { makeable: () => false }), now });
    assert.equal(run.ending.how, "abstained");
    assert.equal(run.winnerId, null);
  });
});

describe("financial and operational boundaries", () => {
  it("stops at the budget ceiling without any further AI call, and never passes it", async () => {
    const g = new Governor({ ceilingUsd: 0.15, wrapUpUsd: 0.12 });
    const model = new Director({ queries: ["desk reset", "exam"] }).asModel();
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH }), governor: g, now });
    assert.equal(run.stopReason, "budget");
    assert.equal(run.ending.how, "stopped");
    assert.ok(g.spentUsd() <= 0.15 + 1e-9, `spent $${g.spentUsd()}`);
    assert.equal(run.steps.at(-1)!.action, "Stopped the scan");
  });

  it("closes research at wrap-up and says so in the trace", async () => {
    const g = new Governor({ wrapUpUsd: 0.0001 });
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH_PAGE }), governor: g, now });
    assert.ok(run.steps.some((s) => s.action === "Called wrap-up"));
    const searches = run.steps.filter((s) => s.actor === "web_search");
    assert.ok(searches.every((s) => !s.ok && /Research is closed/.test(s.result)));
  });

  it("stops when time runs out", async () => {
    let t = 0;
    const g = new Governor({}, () => t);
    const model = new Director({ queries: ["desk reset", "exam"] }).asModel({ beforeTurn: () => (t += 45_000) });
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), governor: g, now });
    assert.equal(run.stopReason, "time");
    assert.ok(run.turns <= Math.ceil(AGENT_LIMITS.wallClockMs / 45_000));
  });

  it("stops at the turn limit when the agent never finishes", async () => {
    const model = new ScriptedModel(() => [toolUse("review_evidence", { why: "Again." })]);
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.stopReason, "turns");
    assert.equal(run.turns, AGENT_LIMITS.maxTurns);
    assert.equal(run.winnerId, null);
  });

  it("enforces per-scan search limits", async () => {
    // One search per turn, so each settles before the next: only the count limit can stop them.
    const model = new ScriptedModel((turn) =>
      turn <= 10 ? [toolUse("web_search", { query: `q${turn}`, purpose: "category", why: "Look." })] : [toolUse("abstain", { reason: "Enough." })],
    );
    const tools = new FakeTools({});
    const run = await runAgent({ brief: BRIEF, model, tools, now });
    assert.equal(tools.log.filter((l) => l.startsWith("search")).length, AGENT_LIMITS.maxSearches);
    const refused = run.steps.filter((s) => s.actor === "web_search" && !s.ok);
    assert.equal(refused.length, 2);
    assert.match(refused[0].result, /Search limit reached/);
  });

  it("holds every parallel search's worst case at once, so a burst can't overspend", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1 ? Array.from({ length: 10 }, (_, i) => toolUse("web_search", { query: `q${i}`, purpose: "category", why: "Look." })) : [toolUse("abstain", { reason: "Enough." })],
    );
    const g = new Governor();
    const tools = new FakeTools({});
    await runAgent({ brief: BRIEF, model, tools, governor: g, now });
    const ran = tools.log.length;
    assert.ok(ran < 10, `${ran} of 10 parallel searches ran`);
    assert.ok(g.spentUsd() <= AGENT_LIMITS.ceilingUsd);
  });

  it("stops on cancel", async () => {
    const controller = new AbortController();
    const model = new Director({ queries: ["desk reset", "exam"] }).asModel({ beforeTurn: (n) => n === 3 && controller.abort() });
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now, signal: controller.signal });
    assert.equal(run.stopReason, "canceled");
  });
});

describe("failures and malformed responses", () => {
  it("survives a failed search, charging its full hold since it may have been billed", async () => {
    const tools = new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH });
    tools.failNextSearch = timeoutFailure();
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools, now });
    const failed = run.steps.find((s) => s.actor === "web_search" && !s.ok)!;
    assert.match(failed.result, /timed out/);
    assert.equal(run.snapshot.uncertainCalls, 1);
    assert.equal(run.ending.how, "finished");
  });

  it("ends after three badly formed tool calls in a row", async () => {
    const model = new ScriptedModel(() => [toolUse("shortlist", { picks: "L1, L2, L3" })]);
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.stopReason, "malformed");
    assert.equal(model.turns, AGENT_LIMITS.maxConsecutiveMalformed);
  });

  it("tells the agent when a tool doesn't exist", async () => {
    const model = new ScriptedModel((turn) => (turn === 1 ? [toolUse("buy_ads", { why: "x" })] : [toolUse("abstain", { reason: "Stop." })]));
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.match(run.steps[0].result, /no tool called buy_ads/);
    assert.equal(run.ending.how, "abstained");
  });

  it("nudges an agent that replies without acting", async () => {
    const model = new ScriptedModel((turn) => (turn === 1 ? [{ type: "text", text: "Let me think." }] : [toolUse("abstain", { reason: "Stop." })]));
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.steps[0].action, "Asked the agent to act");
    assert.equal(run.ending.how, "abstained");
  });

  it("discards a cut-off reply and carries on", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1 ? { stopReason: "max_tokens", content: [toolUse("add_ideas", { ideas: longlistIdeas(3) })] } : [toolUse("abstain", { reason: "Stop." })],
    );
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.steps[0].action, "Discarded a cut-off reply");
    assert.equal(run.workspace.wall.length, 0, "nothing from the cut-off reply was used");
    assert.match(JSON.stringify(model.requests[1].messages.at(-1)), /cut off/);
  });

  it("stops cleanly when the model refuses", async () => {
    const run = await runAgent({ brief: BRIEF, model: new ScriptedModel(() => ({ stopReason: "refusal", content: [] })), tools: new FakeTools({}), now });
    assert.equal(run.stopReason, "model-refused");
    assert.equal(run.ending.how, "stopped");
  });

  it("never retries a failed agent turn", async () => {
    const model = new ScriptedModel(() => new CallFailure("Connection dropped.", true));
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(model.turns, 1);
    assert.equal(run.stopReason, "model-error");
    assert.equal(run.snapshot.uncertainCalls, 1);
  });

  it("passes every tool result back in the order the agent asked", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1 ? [toolUse("review_evidence", { why: "a" }), toolUse("web_search", { query: "desk reset", purpose: "category", why: "b" }), toolUse("review_evidence", { why: "c" })] : [toolUse("abstain", { reason: "Stop." })],
    );
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now });
    const assistant = model.requests[1].messages.at(-2)!;
    const user = model.requests[1].messages.at(-1)!;
    const asked = assistant.content.filter((b) => b.type === "tool_use").map((b) => b.id);
    const answered = user.content.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    assert.deepEqual(answered, asked);
  });
});

describe("honesty: no invented sources, no measured-performance claims", () => {
  it("drops a quote from a page the search didn't return, and an invented quote ID becomes an inference", async () => {
    const page: WorldPage = { ...FRESH_PAGE, citations: [...FRESH_PAGE.citations, { url: "https://invented.example.com/a", citedText: "Made up on November 15, 2026." }] };
    const model = new ScriptedModel((turn, results) => {
      if (turn === 1) return [toolUse("web_search", { query: "desk reset", purpose: "category", why: "Look." })];
      if (turn === 2) {
        assert.equal((results[0].quotes as unknown[]).length, 1);
        const sig = { name: "Invented", category: "creator-behavior", categoryRelation: "adjacent", summary: "x", lineage: "None identified", novelty: "uncertain", whatIsNew: "", lookback: "Not checked", lineageQuery: "", creativeOpportunity: "", audienceNote: "Not documented", inferences: [], observations: [{ statement: "It's huge.", kind: "presence", citationIds: ["C42"], dateText: "", dateBasis: "none", attributedTo: "" }] };
        return [toolUse("record_signal", { signal: sig, why: "File it." })];
      }
      return [toolUse("abstain", { reason: "Stop." })];
    });
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": page }), now });
    assert.deepEqual(run.workspace.sources.map((s) => s.url), [FRESH_URL]);
    const ledger = run.workspace.ledger()!;
    assert.equal(ledger.observations.length, 0);
    assert.equal(ledger.inferences[0].basis, "uncited");
  });

  it("the winner's links come only from the search results", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["desk reset", "exam"] }).asModel(), tools: new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH }), now });
    const winner = run.workspace.developed.get(run.winnerId!)!.candidate;
    const links = sourcesForIdea(winner, run.workspace.ledger()!);
    assert.ok(links.length > 0);
    for (const l of links) assert.ok([FRESH_URL, SECOND_FRESH_URL].includes(l.url), l.url);
  });

  it("can't read a page no search returned", async () => {
    const model = new ScriptedModel((turn) => (turn === 1 ? [toolUse("read_source", { sourceId: "S9", question: "Anything?", why: "Look." })] : [toolUse("abstain", { reason: "Stop." })]));
    const tools = new FakeTools({});
    const run = await runAgent({ brief: BRIEF, model, tools, now });
    assert.match(run.steps[0].result, /isn't a source any search returned/);
    assert.equal(tools.log.length, 0, "no paid call was made");
  });

  it("labels cultural relevance as unverified when no dated observation backs it", async () => {
    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"] }).asModel(), tools: new FakeTools({ latte: STALE_PAGE }), now });
    for (const s of run.workspace.ranking().scores) assert.equal(s.relevanceVerified, false);
  });

  it("the trace shows only stated reasons and code's results, never hidden reasoning", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1
        ? [{ type: "thinking", thinking: "SECRET PLAN", signature: "sig" }, toolUse("review_evidence", { why: "See what we have." })]
        : [toolUse("abstain", { reason: "Stop." })],
    );
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.doesNotMatch(JSON.stringify(run.steps), /SECRET PLAN/);
    assert.equal(run.steps[0].statedReason, "See what we have.");
    // The thinking block is passed back to the model unchanged, as the API requires.
    assert.match(JSON.stringify(model.requests[1].messages), /SECRET PLAN/);
  });
});

describe("text-formatted input in a real loop", () => {
  it("files a signal sent as JSON text and notes that code unpacked it", async () => {
    const sig = { name: "Desk resets", category: "creator-behavior", categoryRelation: "adjacent", summary: "x", lineage: "None identified", novelty: "uncertain", whatIsNew: "", lookback: "Not checked", lineageQuery: "", creativeOpportunity: "", audienceNote: "Not documented", inferences: [], observations: [{ statement: "Desk reset videos are being posted.", kind: "presence", citationIds: ["C1"], dateText: "November 10, 2026", dateBasis: "behavior", attributedTo: "" }] };
    const model = new ScriptedModel((turn) =>
      turn === 1
        ? [toolUse("web_search", { query: "desk reset", purpose: "category", why: "Look." })]
        : turn === 2
          ? [toolUse("record_signal", { signal: JSON.stringify(sig), why: "File it." })]
          : [toolUse("abstain", { reason: "Stop." })],
    );
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now });
    const filed = run.steps.find((s) => s.actor === "record_signal")!;
    assert.equal(filed.ok, true);
    assert.match(filed.flags[0], /unpacked/);
    assert.equal(run.snapshot.stopReason, null);
  });
});

describe("behavior nudges (after the first real run)", () => {
  it("shows evidence quality in code's readout, and calls out thin signals", async () => {
    const run = new Director({ queries: ["desk reset", "exam"] });
    const model = run.asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE, exam: SECOND_FRESH }), now });
    const afterFiling = JSON.stringify(model.requests[2].messages.at(-1));
    assert.match(afterFiling, /Evidence quality: G1 fresh, 8 days, behavior date, 1 independent source/);
    assert.match(afterFiling, /Thin \(one source, or dated only by a page update\): G1, G2/);
  });

  it("gives the agent the leader's weakest criteria and what's left, after a review", async () => {
    const model = new Director({ queries: ["latte", "foam"] }).asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({}, { scoreFor: () => 3 }), now });
    const review = model.requests.map((r) => JSON.stringify(r.messages.at(-1))).find((m) => m.includes("revisionNote"))!;
    assert.match(review, /weakestCriteria/);
    assert.match(review, /revisionsLeft/);
    assert.match(review, /at least 5 points higher/);
  });

  it("requires a revision decision to finish, and shows it as the agent's own words", async () => {
    const noDecision = new ScriptedModel(() => [toolUse("finish", { why: "Done." })]);
    const refused = await runAgent({ brief: BRIEF, model: noDecision, tools: new FakeTools({}), now });
    assert.match(refused.steps[0].result, /revisionDecision/);

    const run = await runAgent({ brief: BRIEF, model: new Director({ queries: ["latte", "foam"] }).asModel(), tools: new FakeTools({}), now });
    const fin = run.steps.find((s) => s.actor === "finish" && s.ok)!;
    assert.match(fin.statedReason!, /On revising: No revision: the leader has no criterion at 3 or below\./);
    assert.equal(run.ending.revisionDecision, "No revision: the leader has no criterion at 3 or below.");
  });

  it("tells the agent the evidence bar and asks for specific reasons", async () => {
    const model = new Director({ queries: ["latte", "foam"] }).asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    const system = model.requests[0].system;
    assert.match(system, /two or more independent sources/);
    assert.match(system, /"Develop L3\." isn't enough/);
    assert.match(system, /say why you did or didn't revise/);
    const specs = model.requests[0].tools;
    const finishSpec = specs.find((t) => t.name === "finish")!;
    assert.ok((finishSpec.input_schema.required as string[]).includes("revisionDecision"));
  });
});

describe("fixes from the second real run (Keurig, 2026-11-18)", () => {
  it("one turn with several badly formed calls is one strike: the agent gets the errors and carries on", async () => {
    const bad = () => toolUse("shortlist", { picks: "L1, L2, L3" });
    const model = new ScriptedModel((turn) => (turn === 1 ? [bad(), bad(), bad()] : [toolUse("abstain", { reason: "Stop." })]));
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.stopReason, null);
    assert.equal(run.ending.how, "abstained");
    assert.equal(model.turns, 2, "the agent saw the three errors and took another turn");
  });

  it("still stops after three turns in a row with nothing usable", async () => {
    const model = new ScriptedModel(() => [toolUse("shortlist", { picks: "L1" }), toolUse("develop", { ideaId: 3 })]);
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.stopReason, "malformed");
    assert.equal(model.turns, 3);
  });

  it("runs an action whose stated reason is missing, and says so in the trace", async () => {
    const model = new ScriptedModel((turn) =>
      turn === 1 ? [toolUse("web_search", { query: "desk reset", purpose: "category" })] : [toolUse("abstain", { reason: "Stop." })],
    );
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now });
    const search = run.steps.find((s) => s.actor === "web_search")!;
    assert.equal(search.ok, true);
    assert.equal(search.statedReason, null);
    assert.match(search.flags[0], /No stated reason given/);
    assert.equal(run.workspace.sources.length, 1, "the work wasn't thrown away");
  });

  it("asks for the stated reason first in every tool that takes one", () => {
    for (const spec of toolSpecs()) {
      const keys = Object.keys(spec.input_schema.properties as Record<string, unknown>);
      if (keys.includes("why")) assert.equal(keys[0], "why", spec.name);
    }
  });

  it("doesn't excuse anything else that's missing", async () => {
    const model = new ScriptedModel((turn) => (turn === 1 ? [toolUse("web_search", { purpose: "category" })] : [toolUse("abstain", { reason: "Stop." })]));
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    assert.equal(run.steps[0].ok, false);
    assert.match(run.steps[0].result, /query/);
  });
});

describe("the signal tool as the API sees it", () => {
  it("takes the signal's fields directly, and lists only the essentials as required", () => {
    const spec = toolSpecs().find((t) => t.name === "record_signal")!;
    const props = spec.input_schema.properties as Record<string, { items?: { required?: string[] } }>;
    assert.equal("signal" in props, false, "no nested signal block");
    assert.equal(Object.keys(props)[0], "why");
    assert.deepEqual([...(spec.input_schema.required as string[])].sort(), ["category", "categoryRelation", "name", "observations", "summary", "why"]);
    assert.deepEqual([...(props.observations.items?.required ?? [])].sort(), ["citationIds", "dateBasis", "dateText", "statement"]);
  });

  it("files a signal sent in the flat shape through the real loop", async () => {
    const model = new ScriptedModel((turn) => {
      if (turn === 1) return [toolUse("web_search", { why: "Look.", query: "desk reset", purpose: "category" })];
      if (turn === 2)
        return [
          toolUse("record_signal", {
            why: "C1 is dated.",
            name: "Desk resets",
            category: "creator-behavior",
            categoryRelation: "adjacent",
            summary: "Students post desk resets before exams.",
            observations: [{ statement: "Desk reset videos are being posted.", citationIds: ["C1"], dateText: "November 10, 2026", dateBasis: "behavior" }],
          }),
        ];
      return [toolUse("abstain", { reason: "Stop." })];
    });
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now });
    const filed = run.steps.find((x) => x.actor === "record_signal")!;
    assert.equal(filed.ok, true, filed.result);
    assert.equal(filed.action, "Filed a signal: Desk resets");
    assert.equal(run.workspace.ledger()!.signals[0].freshness.status, "fresh");
  });
});

describe("round 1: resources framed as an investment", () => {
  it("tells the agent what it's judged on and that unused budget isn't a saving", async () => {
    const model = new Director({ queries: ["latte", "foam"] }).asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    const system = model.requests[0].system;
    assert.match(system, /judged on: the strength of the winning idea, and the strength of the evidence and thinking behind it/);
    assert.match(system, /unused budget is not a saving/);
    assert.doesNotMatch(system, /typically runs 4 to/, "round 2 removed the numeric benchmark");
    assert.doesNotMatch(system, /in good time/);
    assert.match(JSON.stringify(model.requests[0].messages), /still available to invest/);
  });

  it("gives each agent turn room to think at higher effort", () => {
    assert.equal(AGENT_LIMITS.maxTurnOutputTokens, 12_000);
  });
});

describe("round 2 in the loop", () => {
  it("shows open and settled hypotheses in code's readout, and refutations in the trace", async () => {
    const model = new ScriptedModel((turn) => {
      if (turn === 1) return [toolUse("hypothesize", { why: "Steer research.", hypotheses: ["Desk resets are live", "Latte art is live"] }), toolUse("web_search", { why: "Test H1.", query: "desk reset", purpose: "category" })];
      if (turn === 2) return [toolUse("settle_hypothesis", { why: "Search showed it.", id: "H2", verdict: "refuted", evidence: ["S1"], note: "Nothing on latte art turned up." })];
      return [toolUse("abstain", { reason: "Stop." })];
    });
    const run = await runAgent({ brief: BRIEF, model, tools: new FakeTools({ "desk reset": FRESH_PAGE }), now });
    assert.match(JSON.stringify(model.requests[1].messages.at(-1)), /Hypotheses: H1 open: \\"Desk resets are live\\"/);
    const settled = run.steps.find((s) => s.actor === "settle_hypothesis")!;
    assert.equal(settled.changedCourse, 'Refuted H2: "Latte art is live"');
    assert.equal(run.workspace.hypotheses[1].status, "refuted");
  });

  it("flags weak finalists as candidates to replace after a review", async () => {
    const model = new Director({ queries: ["latte", "foam"] }).asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({}, { scoreFor: () => 3 }), now });
    const review = model.requests.map((r) => JSON.stringify(r.messages.at(-1))).find((m) => m.includes("replacementNote"))!;
    assert.match(review, /weakFinalists/);
    assert.match(review, /candidate to replace/);
    assert.match(review, /reviewRoundsLeft\\":1/);
  });

  it("asks the agent to work from hypotheses and to change direction when one is refuted", async () => {
    const model = new Director({ queries: ["latte", "foam"] }).asModel();
    await runAgent({ brief: BRIEF, model, tools: new FakeTools({}), now });
    const system = model.requests[0].system;
    assert.match(system, /Work from hypotheses/);
    assert.match(system, /When a bet is refuted, change direction/);
    assert.match(system, /Different briefs should lead you down different paths/);
  });
});
