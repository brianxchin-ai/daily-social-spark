import type { CandidateScore } from "../evaluation/scoring.ts";
import type { AgentReport, CandidateEvaluation, CallUsage as UiCallUsage, HypothesisSpark, Longlist, RefinementReport, ResearchOutcome } from "../types.ts";
import { AGENT_MODEL } from "./anthropic.ts";
import type { AgentRun } from "./loop.ts";
import type { Developed, Workspace } from "./workspace.ts";

/**
 * Turn an agent run into the result the Day 5 page already renders, plus the
 * agent's own report for the drawer. Every number here comes from code's
 * records of the run; nothing is taken from the agent's word except its
 * stated reasons and its labeled tie-break judgment.
 */

const RESEARCH_STEPS = new Set(["search", "read"]);
/** How long the run's own evidence is shown as current (matches a signed ledger's lifetime). */
const LEDGER_DISPLAY_MS = 30 * 60_000;

/** The first version of an idea, following revisions back to their root. */
function rootOf(ws: Workspace, d: Developed): Developed {
  let current = d;
  while (current.revises) {
    const prev = ws.developed.get(current.revises);
    if (!prev) break;
    current = prev;
  }
  return current;
}

function evaluationOf(d: Developed, score: CandidateScore): CandidateEvaluation {
  const a = d.assessment!;
  return {
    candidateId: d.candidate.id,
    evaluatorLabel: a.evaluatorLabel,
    results: a.results,
    meaningfulAudioVariations: a.meaningfulAudioVariations,
    makeableNote: a.makeableNote,
    score,
  };
}

export function agentReport(run: AgentRun): AgentReport {
  const s = run.snapshot;
  return {
    steps: run.steps,
    turns: run.turns,
    how: run.ending.how,
    endReason: run.ending.reason,
    stopReason: run.stopReason,
    tieJudgment: run.ending.tieJudgment,
    revisionDecision: run.ending.revisionDecision,
    comparison: run.ending.comparison,
    hypotheses: run.workspace.hypotheses.map((h) => ({ ...h, evidence: [...h.evidence] })),
    spentUsd: s.spentUsd,
    ceilingUsd: s.ceilingUsd,
    elapsedMs: s.elapsedMs,
    counts: { searches: s.searches, reads: s.reads, evaluations: s.evaluations, rescores: s.rescores, toolCalls: s.toolCalls },
    changesOfCourse: run.steps.filter((x) => x.changedCourse).length,
    uncertainCalls: s.uncertainCalls,
  };
}

export function toSpark(run: AgentRun, options: { stamp: number; now: Date }): HypothesisSpark {
  const ws = run.workspace;
  const brief = ws.brief;
  const ledger = ws.ledger();

  // Every idea the panel reviewed, as first developed. A revision appears through `refinement`.
  const originals = ws
    .finalists()
    .map((d) => rootOf(ws, d))
    .filter((d): d is Developed => !!d.assessment);
  const ranking = ws.rankVersions(originals);

  const winner = run.winnerId ? (ws.developed.get(run.winnerId) ?? null) : null;
  const root = winner ? rootOf(ws, winner) : null;
  const leaderId = root && originals.some((d) => d.candidate.id === root.candidate.id) ? root.candidate.id : null;

  // Code's order, with the winner first: it won on its current version (or an exact tie the agent decided).
  const ordered = [...ranking.scores];
  if (leaderId) {
    const i = ordered.findIndex((x) => x.candidateId === leaderId);
    if (i > 0) ordered.unshift(...ordered.splice(i, 1));
    let rank = 0;
    for (const x of ordered) x.rank = x.candidateId === leaderId || !x.rejected ? ++rank : null;
  }
  const evaluations = ordered.map((score) => evaluationOf(ws.developed.get(score.candidateId)!, score));

  const refinement = refinementOf(ws, winner, leaderId, run.ending.revisionDecision);

  const research: ResearchOutcome =
    ledger && ws.queries.length > 0
      ? {
          status: "verified",
          ledger: { ...ledger, researchUsage: researchUsageOf(run) },
          expiresAt: new Date(options.now.getTime() + LEDGER_DISPLAY_MS).toISOString(),
        }
      : { status: "unavailable", reason: "The agent didn't run any searches for this scan." };

  const creativeCalls: UiCallUsage[] = run.calls
    .filter((c) => !RESEARCH_STEPS.has(c.step))
    .map((c) => ({ step: c.step, model: c.model, inputTokens: c.inputTokens, outputTokens: c.outputTokens, estimatedCostUsd: c.estimatedCostUsd }));

  const longlist: Longlist | undefined = ws.wall.length
    ? {
        // Open shape: no shortlist. An idea is "picked" if the agent developed it.
        setAside: "",
        ideas: ws.wall.map((idea) => {
          const developed = ws.originalOf(idea.id);
          return { ...idea, pick: developed ? { reason: developed.why || "Developed in full.", candidateId: developed.candidate.id } : null };
        }),
      }
    : undefined;

  return {
    origin: "ai-hypothesis",
    id: `agent-${brief.platform}-${options.stamp}`,
    generatedAt: options.now.toISOString(),
    brand: brief.brand,
    platform: brief.platform,
    audience: brief.audience,
    candidates: originals.map((d) => d.candidate),
    evaluation: { evaluations, leaderId },
    refinement,
    finalCandidate: leaderId && winner ? winner.candidate : null,
    generation: {
      model: AGENT_MODEL,
      calls: creativeCalls,
      inputTokens: creativeCalls.reduce((n, c) => n + c.inputTokens, 0),
      outputTokens: creativeCalls.reduce((n, c) => n + c.outputTokens, 0),
      estimatedCostUsd: creativeCalls.reduce((n, c) => n + c.estimatedCostUsd, 0),
    },
    research,
    diversity: ws.diversity(),
    longlist,
    agent: agentReport(run),
  };
}

function researchUsageOf(run: AgentRun) {
  const calls = run.calls
    .filter((c) => RESEARCH_STEPS.has(c.step))
    .map((c) => ({ step: c.step, inputTokens: c.inputTokens, outputTokens: c.outputTokens, webSearches: c.webSearches ?? 0, estimatedCostUsd: c.estimatedCostUsd }));
  return {
    calls,
    webSearches: calls.reduce((n, c) => n + c.webSearches, 0),
    estimatedCostUsd: calls.reduce((n, c) => n + c.estimatedCostUsd, 0),
  };
}

/** The revision story of the winning idea, in the fixed pipeline's shape. Other revisions are in the agent trace. */
function refinementOf(ws: Workspace, winner: Developed | null, leaderId: string | null, decision: string | null): RefinementReport {
  if (!winner || !leaderId) return { status: "skipped", reason: "No idea cleared the bar, so nothing was refined." };
  const chain = ws.revisions.filter((r) => rootOf(ws, ws.developed.get(r.originalId)!).candidate.id === leaderId);
  const rec = chain.find((r) => r.revisedId === winner.candidate.id) ?? chain.at(-1);
  if (!rec) {
    return {
      status: "skipped",
      reason: decision
        ? `The agent didn't revise the winning idea. In its words: “${decision}”`
        : "The agent didn't revise the winning idea before finishing (its stated reason is in the agent trace).",
    };
  }
  const revised = ws.developed.get(rec.revisedId)!;
  return {
    status: "complete",
    originalId: leaderId,
    critique: {
      weakness: rec.weakness,
      affectedCriterion: rec.affectedCriterion,
      revisionJustified: true,
      decisionReason: rec.why || "The agent judged one revision worthwhile.",
      changeSummary: rec.whatChanged,
    },
    revision: {
      candidate: revised.candidate,
      validationProblems: [],
      evaluation: evaluationOf(revised, ws.scoreOf(revised)),
      checks: rec.checks,
      checksRationale: rec.checksRationale,
      evidenceRationale: null,
    },
    decision: rec.decision,
  };
}
