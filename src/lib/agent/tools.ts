import { z } from "zod";
import { formatScore, rankValue } from "../evaluation/scoring.ts";
import { independentOrigins, LedgerDraftSchema } from "../research/ledger.ts";
import {
  CandidateDraftSchema,
  LonglistIdeaSchema,
  validateLonglistBatch,
  validateRevisedCandidate,
} from "../spark-schema.ts";
import type { Ending, Workspace } from "./workspace.ts";

/**
 * The agent's toolkit: what each tool takes, and how the free ones run.
 *
 * Every tool asks for `why`: the agent's stated reason, shown in the trace as
 * exactly that ("Agent's stated reason"), never as its inner reasoning. What
 * the tool did and found is written by code from the workspace, so the trace
 * reports observable actions and results.
 *
 * Paid tools (web_search, read_source, evaluate, revise) are declared here and
 * run by the loop, which asks the governor first.
 */

const why = z.string().describe("One short sentence: why you're taking this action now. Shown to the user as your stated reason.");

export const TOOL_INPUTS = {
  web_search: z.object({
    query: z.string().describe("The search query. Specific beats broad."),
    purpose: z
      .enum(["brand", "category", "cross-category", "depth"])
      .describe("brand: about the brand itself. category: its category. cross-category: culture beyond the category. depth: checking or deepening a lead."),
    why,
  }),
  read_source: z.object({
    sourceId: z.string().describe("A source ID (S3) from an earlier search. Only pages a search returned can be read."),
    question: z.string().describe("What you want to learn from the page."),
    why,
  }),
  record_signal: z.object({
    signal: LedgerDraftSchema.shape.signals.element,
    categoryTerms: z.array(z.string()).describe("Words naming the brand's own category, e.g. 'coffee'. May be empty.").optional(),
    why,
  }),
  review_evidence: z.object({ why }),
  add_ideas: z.object({
    ideas: z.array(LonglistIdeaSchema.omit({ id: true })).describe("1 to 10 short ideas for the longlist. Code assigns IDs (L1, L2…)."),
    why,
  }),
  shortlist: z.object({
    picks: z
      .array(z.object({ ideaId: z.string().describe("A longlist ID."), reason: z.string().describe("One sentence on why it made the cut.") }))
      .describe("Exactly 3 genuinely different longlist ideas."),
    setAside: z.string().describe("One or two sentences on why the others didn't make the cut."),
    why,
  }),
  develop: z.object({
    ideaId: z.string().describe("A shortlisted longlist ID."),
    treatment: CandidateDraftSchema,
    why,
  }),
  evaluate: z.object({ why }),
  revise: z.object({
    candidateId: z.string().describe("The evaluated candidate to improve."),
    weakness: z.string().describe("The specific weakness the revision fixes, in one or two sentences."),
    affectedCriterion: z
      .enum(["culturalRelevance", "stopPower", "shareability", "watchThrough", "participation", "brandPlatformFit"])
      .describe("The rubric criterion that weakness most affects."),
    whatChanged: z.string().describe("What you changed, in one or two sentences."),
    revised: CandidateDraftSchema,
    why,
  }),
  finish: z.object({
    tieBreak: z
      .object({
        candidateId: z.string(),
        note: z.string().describe("Your creative judgment on why this one is likelier to resonate. Labeled as judgment, not data."),
      })
      .describe("Only if the review left an exact tie at the top: which tied idea should win, and why.")
      .optional(),
    why,
  }),
  abstain: z.object({
    reason: z.string().describe("Why no idea should be recommended. Shown to the user."),
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];
export const PAID_TOOLS: ReadonlySet<ToolName> = new Set(["web_search", "read_source", "evaluate", "revise"]);

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  web_search:
    "Run one live web search. Code files every result as a source (S1…) with any quoted passages (C1…). Costs money; limited per scan; closed during wrap-up.",
  read_source:
    "Read one page that an earlier search returned, to get dated, quotable detail. Costs money; limited per scan; closed during wrap-up.",
  record_signal:
    "File a cultural signal on the evidence board, citing quote IDs (C…). Code checks every citation, date and figure; uncited or unsupported claims become inferences. Free.",
  review_evidence:
    "Get code's factual report on the evidence: which signals are fresh (dated within 30 days), which rest on one source, and what's missing. Free.",
  add_ideas: "Add short ideas to the longlist (at least 10 are needed before narrowing). Free.",
  shortlist:
    "Narrow the longlist to exactly 3 genuinely different ideas. You may re-shortlist later to swap a pick (limited rounds). Free.",
  develop:
    "Write the full treatment for one shortlisted idea. Code reports how it will be judged: fresh trend, original format, or stale trend (rejected), and whether it repeats something this person has seen. Free.",
  evaluate:
    "Send all three developed finalists to the independent review panel, which scores them blind against the rubric. Costs money; at most 2 rounds.",
  revise:
    "Improve one evaluated finalist; the revision is rescored blind. Code keeps it only if it gains at least 5 points, keeps the mechanic, fixes the weakness and adds no unsupported claims. Costs money; limited per scan.",
  finish:
    "End the scan. Requires a longlist of 10+, 3 developed finalists, all evaluated. Code picks the winner from the scores; your tie-break counts only on an exact tie at the top.",
  abstain: "End the scan without recommending an idea, when nothing worth making can be found. The reason is shown to the user.",
};

/** What one tool call produced: what the agent sees, and code's line for the trace. */
export interface ToolOutcome {
  ok: boolean;
  /** Sent back to the agent as the tool result. */
  forAgent: Record<string, unknown>;
  /** Code's plain-English account of what happened. */
  result: string;
  /** Rejection risks and other warnings code raised. */
  flags: string[];
  /** Set when the action visibly changed direction (dropped a pick, went back to research…). */
  changedCourse: string | null;
  /** Set when the action ends the run. */
  ending: Ending | null;
}

const fail = (problem: string, flags: string[] = []): ToolOutcome => ({
  ok: false,
  forAgent: { ok: false, problem },
  result: `Refused: ${problem}`,
  flags,
  changedCourse: null,
  ending: null,
});

/** Parse a tool's input. Returns the problems the agent should fix if it's malformed. */
/**
 * Models sometimes send a nested object or list as a block of JSON text.
 * Unpack such text, at any depth. Used only after the input as sent has
 * failed the format check, and the unpacked version must pass the same check.
 */
function unpackText(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return unpackText(JSON.parse(t), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => unpackText(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpackText(v, depth + 1)]));
  }
  return value;
}

export function parseInput<T extends ToolName>(
  name: T,
  input: unknown,
): { ok: true; value: z.infer<(typeof TOOL_INPUTS)[T]>; unpacked?: boolean } | { ok: false; problem: string } {
  const result = TOOL_INPUTS[name].safeParse(input);
  if (result.success) return { ok: true, value: result.data as z.infer<(typeof TOOL_INPUTS)[T]> };
  const retry = TOOL_INPUTS[name].safeParse(unpackText(input));
  if (retry.success) return { ok: true, value: retry.data as z.infer<(typeof TOOL_INPUTS)[T]>, unpacked: true };
  const issues = result.error.issues.slice(0, 5).map((i) => [i.path.join("."), i.message].filter(Boolean).join(": "));
  return { ok: false, problem: `Badly formed input for ${name}: ${issues.join("; ")}` };
}

/* ---------- Free tools ---------- */

export function recordSignal(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.record_signal>): ToolOutcome {
  const filed = ws.addSignal(input.signal, input.categoryTerms ?? []);
  if (!filed.ok) return fail(filed.problem);
  const ledger = ws.ledger()!;
  const signal = ledger.signals.find((s) => s.id === filed.signalId)!;
  const own = ledger.observations.filter((o) => o.signalId === signal.id);
  const independent = independentOrigins(own);
  const flags: string[] = [];
  const dropped = input.signal.observations.length - signal.observationIds.length;
  if (dropped > 0) flags.push(`${dropped} of ${input.signal.observations.length} observation(s) didn't hold up against the quotes and became inferences.`);
  if (signal.observationIds.length === 0) flags.push("No quoted observations survived, so this signal can't directly support an idea.");
  if (signal.freshness.status !== "fresh") flags.push(`Not fresh: ${signal.freshness.reason || "no date within 30 days"}.`);
  if (own.length > 0 && independent === 0) flags.push("Its only sources are owned by the brand or the platform, so none counts as independent.");
  const result = `Filed ${signal.id} "${signal.name}": ${signal.observationIds.length} quoted observation(s), ${signal.freshness.status}${
    signal.freshness.ageDays != null ? ` (${signal.freshness.ageDays} days)` : ""
  }, ${independent} independent source(s).`;
  return {
    ok: true,
    forAgent: {
      ok: true,
      signalId: signal.id,
      observationsKept: signal.observationIds.length,
      freshness: signal.freshness,
      independentOrigins: independent,
      flags,
    },
    result,
    flags,
    changedCourse: null,
    ending: null,
  };
}

export function reviewEvidence(ws: Workspace): ToolOutcome {
  const report = ws.evidenceReport();
  const result = `${report.signals.length} signal(s) on the board, ${report.freshSignals.length} fresh; ${report.searches} search(es), ${report.usableQuotes} usable quote(s).${
    report.gaps.length ? ` Gaps: ${report.gaps.join(" ")}` : ""
  }`;
  return { ok: true, forAgent: { ok: true, ...report }, result, flags: report.gaps, changedCourse: null, ending: null };
}

export function addIdeas(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.add_ideas>): ToolOutcome {
  const checked = validateLonglistBatch(input.ideas);
  if (!checked.ok) return fail(`Ideas didn't pass the format checks: ${checked.problems.slice(0, 4).join("; ")}`);
  const hadShortlist = ws.picks.length > 0;
  const { added, problem } = ws.addIdeas(checked.value);
  if (added.length === 0) return fail(problem ?? "No ideas were added.");
  const flags = problem ? [problem] : [];
  return {
    ok: true,
    forAgent: { ok: true, added: added.map((i) => ({ id: i.id, headline: i.headline, basis: i.basis, groundedIn: i.groundedIn })), longlistSize: ws.wall.length, flags },
    result: `Added ${added.length} idea(s) (${added.map((i) => i.id).join(", ")}); the longlist has ${ws.wall.length}.`,
    flags,
    changedCourse: hadShortlist ? "Went back to the idea wall after shortlisting." : null,
    ending: null,
  };
}

export function shortlist(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.shortlist>): ToolOutcome {
  const done = ws.shortlist(input.picks, input.setAside);
  if (!done.ok) return fail(done.problem);
  const ids = ws.picks.map((p) => p.ideaId).join(", ");
  return {
    ok: true,
    forAgent: { ok: true, finalists: ws.picks, nextStep: "Develop each finalist in full." },
    result: `Shortlisted ${ids}.`,
    flags: [],
    changedCourse: done.replaced.length ? `Dropped ${done.replaced.join(", ")} from the shortlist.` : null,
    ending: null,
  };
}

export function develop(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.develop>): ToolOutcome {
  const checked = validateRevisedCandidate(input.treatment);
  if (!checked.ok) return fail(`The treatment didn't pass the format checks: ${checked.problems.slice(0, 4).join("; ")}`);
  const rewriting = !!ws.currentVersion(input.ideaId);
  const done = ws.develop(input.ideaId, checked.value);
  if (!done.ok) return fail(done.problem);
  const c = done.candidate;
  const atRisk = done.flags.some((f) => f.startsWith("REJECTION RISK"));
  return {
    ok: true,
    forAgent: { ok: true, candidateId: c.id, ideaId: input.ideaId, groundedIn: c.groundedIn, flags: done.flags },
    result: `${rewriting ? "Rewrote" : "Developed"} ${input.ideaId} as ${c.id}: "${c.headline}".${atRisk ? " Code flagged a rejection risk." : ""}`,
    flags: done.flags,
    changedCourse: rewriting ? `Rewrote ${input.ideaId} before evaluation.` : null,
    ending: null,
  };
}

/** End the scan, if code's requirements are met; code picks the winner. */
export function finish(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.finish>): ToolOutcome {
  const problems = ws.finishProblems();
  if (problems.length) return fail(`Not ready to finish. ${problems.join(" ")}`);
  const tied = ws.tiedWithLeader();
  const { winnerId, tieJudgment } = ws.decideWinner(input.tieBreak);
  const flags: string[] = [];
  if (input.tieBreak && !tieJudgment) {
    flags.push(tied.length ? "Your tie-break named an idea that isn't tied for the top, so code's ranking decided." : "There was no exact tie at the top, so code's ranking decided.");
  }
  const ending: Ending = {
    how: "finished",
    reason: winnerId ? "The agent finished and code picked the winner from the review panel's scores." : "The agent finished, but no finalist cleared the bar.",
    tieJudgment,
  };
  ws.end(ending);
  const winner = winnerId ? ws.developed.get(winnerId)! : null;
  const score = winner ? ws.scoreOf(winner) : null;
  return {
    ok: true,
    forAgent: { ok: true, winnerId, flags },
    result: winner
      ? `Finished. Winner: ${winnerId} "${winner.candidate.headline}" (Spark Score ${formatScore(score!.rankingScore)}${tieJudgment ? ", chosen by the agent's judgment on an exact tie" : ""}).`
      : "Finished with no idea clearing the bar.",
    flags,
    changedCourse: null,
    ending,
  };
}

export function abstain(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.abstain>): ToolOutcome {
  const reason = input.reason.trim();
  if (!reason) return fail("Give a reason for abstaining.");
  const ending: Ending = { how: "abstained", reason, tieJudgment: null };
  ws.end(ending);
  return { ok: true, forAgent: { ok: true }, result: `Abstained: ${reason}`, flags: [], changedCourse: null, ending };
}

/**
 * When the run is stopped by a limit, code finishes it with no further AI
 * call: the best finalist already scored wins, if any cleared the bar.
 */
export function forceFinish(ws: Workspace, why: string): { winnerId: string | null; ending: Ending } {
  const { leaderId } = ws.ranking();
  const ending: Ending = {
    how: "stopped",
    reason: leaderId
      ? `${why} Code finished the scan with the best idea already scored.`
      : `${why} No scored idea cleared the bar, so there's no recommendation.`,
    tieJudgment: null,
  };
  ws.end(ending);
  return { winnerId: leaderId, ending };
}

/** Compact scores for the agent after an evaluation: per-criterion scores, the Spark Score and code's verdict. */
export function scoreSummary(ws: Workspace) {
  const ranking = ws.ranking();
  return ranking.scores.map((s) => {
    const d = ws.developed.get(s.candidateId)!;
    return {
      candidateId: s.candidateId,
      headline: d.candidate.headline,
      sparkScore: Math.round(s.rankingScore),
      rankingValue: Math.round(rankValue(s)),
      kind: s.kind,
      rank: s.rank,
      rejected: s.rejected,
      rejectionReasons: s.rejectionReasons.map((r) => r.message),
      criteria: d.assessment!.results.map((r) => ({ id: r.criterionId, score: r.score, rationale: r.rationale })),
      makeableNote: d.assessment!.makeableNote,
    };
  });
}
