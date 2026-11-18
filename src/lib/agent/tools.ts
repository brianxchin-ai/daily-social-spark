import { z } from "zod";
import { formatScore, rankValue } from "../evaluation/scoring.ts";
import { independentOrigins, LedgerDraftSchema } from "../research/ledger.ts";
import {
  CandidateDraftSchema,
  LonglistIdeaSchema,
  validateLonglistBatch,
  validateRevisedCandidate,
} from "../spark-schema.ts";
import { AGENT_HEAD_START, routesSupported, type Ending, type Workspace } from "./workspace.ts";

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

/**
 * Day 6: a signal as the agent files it. Only what honesty depends on is
 * required (what the sources show, the quote IDs, the dates). The research-
 * library details are optional, with defaults that say plainly they weren't
 * checked. Code's evidence rules (checkLedger) are the same either way.
 */
const SIGNAL = LedgerDraftSchema.shape.signals.element.shape;
const OBSERVATION = SIGNAL.observations.element.shape;
export const AgentSignalSchema = z.object({
  name: SIGNAL.name,
  category: SIGNAL.category,
  categoryRelation: SIGNAL.categoryRelation,
  summary: SIGNAL.summary,
  observations: z
    .array(
      z.object({
        statement: OBSERVATION.statement,
        citationIds: OBSERVATION.citationIds,
        dateText: OBSERVATION.dateText,
        dateBasis: OBSERVATION.dateBasis,
        kind: OBSERVATION.kind.optional(),
        attributedTo: OBSERVATION.attributedTo.optional(),
      }),
    )
    .min(1)
    .max(8)
    .describe("1 to 8 observations, each citing quote IDs (C…) from the searches."),
  audienceNote: SIGNAL.audienceNote.optional(),
  novelty: SIGNAL.novelty.optional(),
  whatIsNew: SIGNAL.whatIsNew.optional(),
  lineage: SIGNAL.lineage.optional(),
  lookback: SIGNAL.lookback.optional(),
  lineageQuery: SIGNAL.lineageQuery.optional(),
  creativeOpportunity: SIGNAL.creativeOpportunity.optional(),
  inferences: SIGNAL.inferences.optional(),
});
export type AgentSignal = z.infer<typeof AgentSignalSchema>;

/** Fill the optional details with defaults that say they weren't checked. */
export function toSignalDraft(s: AgentSignal): import("./workspace.ts").SignalDraft {
  return {
    name: s.name,
    category: s.category,
    categoryRelation: s.categoryRelation,
    summary: s.summary,
    lineage: s.lineage ?? "Not identified",
    novelty: s.novelty ?? "uncertain",
    whatIsNew: s.whatIsNew ?? "",
    lookback: s.lookback ?? "Not checked",
    lineageQuery: s.lineageQuery ?? "",
    creativeOpportunity: s.creativeOpportunity ?? "",
    audienceNote: s.audienceNote ?? "Not documented",
    observations: s.observations.map((o) => ({
      statement: o.statement,
      kind: o.kind ?? "presence",
      citationIds: o.citationIds,
      dateText: o.dateText,
      dateBasis: o.dateBasis,
      attributedTo: o.attributedTo ?? "",
    })),
    inferences: s.inferences ?? [],
  };
}

const why = z.string().describe("One short sentence: why you're taking this action now. Shown to the user as your stated reason.");

export const TOOL_INPUTS = {
  web_search: z.object({
    why,
    query: z.string().describe("The search query. Specific beats broad."),
    purpose: z
      .enum(["brand", "category", "cross-category", "depth"])
      .describe("brand: about the brand itself. category: its category. cross-category: culture beyond the category. depth: checking or deepening a lead."),
  }),
  read_source: z.object({
    why,
    sourceId: z.string().describe("A source ID (S3) from an earlier search. Only pages a search returned can be read."),
    question: z.string().describe("What you want to learn from the page."),
  }),
  // The signal's fields sit directly in the input: real runs kept sending a nested "signal" block as broken text.
  record_signal: z.object({
    why,
    ...AgentSignalSchema.shape,
    role: z
      .enum(["performing", "emerging"])
      .describe("Your read of what this signal shows: performing (established and reported as doing well now) or emerging (early, but showing signs of spreading).")
      .optional(),
    categoryTerms: z.array(z.string()).describe("Words naming the brand's own category, e.g. 'coffee'. May be empty.").optional(),
  }),
  review_evidence: z.object({ why }),
  hypothesize: z.object({
    why,
    hypotheses: z
      .array(z.string())
      .describe("1 to 3 testable bets about what will resonate for this brand, platform and audience right now. Code assigns IDs (H1, H2…)."),
  }),
  settle_hypothesis: z.object({
    why,
    id: z.string().describe("A hypothesis ID (H1…)."),
    verdict: z.enum(["supported", "refuted", "dropped"]),
    evidence: z.array(z.string()).describe("Evidence IDs from this scan (G…, C… or S…). Required for supported or refuted."),
    note: z.string().describe("One sentence on what settled it."),
  }),
  add_ideas: z.object({
    why,
    ideas: z.array(LonglistIdeaSchema.omit({ id: true })).describe("1 to 10 short ideas to note on your idea wall. Code assigns IDs (L1, L2…)."),
  }),
  gut_check: z.object({
    why,
    ideaIds: z.array(z.string()).describe("1 to 10 idea IDs from your wall (L…)."),
  }),
  develop: z.object({
    why,
    ideaId: z.string().describe("An idea ID from your wall (L…)."),
    route: z
      .enum(["proven", "primed", "original"])
      .describe(
        "proven: builds on an established pattern with reported evidence it's performing now, with a twist this brand owns. primed: builds on an early or novel signal showing signs it's about to spread. original: an original format not built on any trend.",
      ),
    reachThesis: z
      .object({
        behaviors: z.string().describe("Which viewer behaviors should earn it views (stopping, watching through, sending, saving, joining in) and why. A hypothesis, no numbers."),
        wouldProveWrong: z.string().describe("What would show the bet is wrong."),
      })
      .describe("Your bet on why this idea earns organic views."),
    treatment: CandidateDraftSchema,
  }),
  evaluate: z.object({
    why,
    candidateIds: z.array(z.string()).describe("1 to 3 developed ideas (cand-…) to send for review, at their current version and not yet reviewed."),
  }),
  revise: z.object({
    why,
    candidateId: z.string().describe("The evaluated candidate to improve."),
    weakness: z.string().describe("The specific weakness the revision fixes, in one or two sentences."),
    affectedCriterion: z
      .enum(["culturalRelevance", "stopPower", "shareability", "watchThrough", "participation", "brandPlatformFit"])
      .describe("The rubric criterion that weakness most affects."),
    whatChanged: z.string().describe("What you changed, in one or two sentences."),
    revised: CandidateDraftSchema,
  }),
  finish: z.object({
    why,
    tieBreak: z
      .object({
        candidateId: z.string(),
        note: z.string().describe("Your creative judgment on why this one is likelier to resonate. Labeled as judgment, not data."),
      })
      .describe("Only if the review left an exact tie at the top: which tied idea should win, and why.")
      .optional(),
    revisionDecision: z
      .string()
      .describe("One or two sentences: why you did or didn't revise the leading idea, naming the criterion or evidence that decided it."),
    comparison: z
      .string()
      .describe("Two or three sentences: what else you considered (other ideas, directions or evidence), which reviewed contenders the winner beat, and why it wins. If it was the only idea reviewed, say why no contender was worth reviewing."),
    routeDecision: z
      .string()
      .describe("One or two sentences: which route the winner takes (proven, primed or original) and why that route beat the others for this brief."),
  }),
  abstain: z.object({
    reason: z.string().describe("Why no idea should be recommended. Shown to the user."),
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;
export const TOOL_NAMES = Object.keys(TOOL_INPUTS) as ToolName[];
export const PAID_TOOLS: ReadonlySet<ToolName> = new Set(["web_search", "read_source", "gut_check", "evaluate", "revise"]);

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  web_search:
    "Run one live web search. Code files every result as a source (S1…) with any quoted passages (C1…). Costs money; limited per scan; closed during wrap-up.",
  read_source:
    "Read one page that an earlier search returned, to get dated, quotable detail. Costs money; limited per scan; closed during wrap-up.",
  record_signal:
    "File a cultural signal on the evidence board, citing quote IDs (C…). Code checks every citation, date and figure; uncited or unsupported claims become inferences. Free.",
  hypothesize:
    "Record 1 to 3 working bets about what will resonate, to steer your research. Code tracks each as open until you settle it. Free.",
  settle_hypothesis:
    "Mark a working bet supported, refuted or dropped, citing evidence IDs from this scan. Code checks the IDs. A refuted bet is a signal to change direction. Free.",
  review_evidence:
    "Get code's factual report on the evidence: which signals are fresh (dated within 30 days), which rest on one source, and what's missing. Free.",
  add_ideas: "Note short ideas on your idea wall, as many or as few as are useful. Free.",
  gut_check:
    "Get a quick, cheap first read on up to 10 noted ideas from the review panel: stop power and shareability (1 to 5) and a one-line note, judged from the headline and mechanic alone. It's a first read, not a score: it never counts toward the Spark Score or the winner. Costs about a cent or two; limited per scan.",
  develop:
    "Write the full treatment for any idea on your wall. Code reports how it will be judged: fresh trend, original format, or stale trend (rejected), and whether it repeats something this person has seen. Free.",
  evaluate:
    "Send 1 to 3 developed ideas to the independent review panel, which scores them blind against the rubric. Code ranks every idea reviewed in the scan. Costs money; limited reviews per scan.",
  revise:
    "Improve one reviewed idea; the revision is rescored blind. Code keeps it only if it keeps the mechanic, fixes the weakness, adds no unsupported claims, passes every rejection rule and gains at least 5 points (for a rejected original, clearing the rejection without lowering the score is enough). Costs money; limited per scan.",
  finish:
    "End the scan. Requires at least one developed idea reviewed by the panel, and every hypothesis settled. Code picks the winner from everything reviewed; your tie-break counts only on an exact tie at the top. Say what else you considered and why the winner beats it.",
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
): { ok: true; value: z.infer<(typeof TOOL_INPUTS)[T]>; unpacked?: boolean; missingWhy?: boolean } | { ok: false; problem: string } {
  const schema = TOOL_INPUTS[name];
  // The earlier nested signal shape: lift it, and note when it arrived as text.
  const nested = name === "record_signal" && input && typeof input === "object" ? (input as Record<string, unknown>).signal : undefined;
  if (nested !== undefined) input = liftNestedSignal(input);
  const liftedText = typeof nested === "string" && !(input && typeof input === "object" && "signal" in (input as Record<string, unknown>));
  if (typeof nested === "string" && !liftedText) {
    return {
      ok: false,
      problem: `Badly formed input for ${name}: the signal was sent as text that isn't valid JSON. Send its fields directly (name, category, categoryRelation, summary, observations) instead of inside "signal".`,
    };
  }
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data as z.infer<(typeof TOOL_INPUTS)[T]>, ...(liftedText ? { unpacked: true } : {}) };
  const unpacked = unpackText(input);
  const retry = schema.safeParse(unpacked);
  if (retry.success) return { ok: true, value: retry.data as z.infer<(typeof TOOL_INPUTS)[T]>, unpacked: true };
  // A missing stated reason never throws away the work: the action runs, and the trace says no reason was given.
  const onlyWhyMissing = (issues: z.core.$ZodIssue[]) => issues.length > 0 && issues.every((i) => i.path.length === 1 && i.path[0] === "why");
  for (const [candidate, wasUnpacked] of [[input, false], [unpacked, true]] as const) {
    const attempt = schema.safeParse(candidate);
    if (attempt.success || !onlyWhyMissing(attempt.error.issues) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const withWhy = schema.safeParse({ ...(candidate as Record<string, unknown>), why: "" });
    if (withWhy.success) {
      return { ok: true, value: withWhy.data as z.infer<(typeof TOOL_INPUTS)[T]>, missingWhy: true, ...(wasUnpacked ? { unpacked: true } : {}) };
    }
  }
  // Report what's actually wrong: the unpacked version's problems when unpacking changed anything.
  const changed = JSON.stringify(unpacked) !== JSON.stringify(input);
  const source = changed ? retry.error.issues : result.error.issues;
  const issues = source.slice(0, 6).map((i) => [i.path.join("."), i.message].filter(Boolean).join(": "));
  const textNotJson = !changed && source.some((i) => /expected (object|array), received string/.test(i.message));
  return {
    ok: false,
    problem: `Badly formed input for ${name}: ${issues.join("; ")}${
      textNotJson ? ". A nested field was sent as text that isn't valid JSON: send it as a structured object, not a string." : ""
    }`,
  };
}

/* ---------- Free tools ---------- */

/** The earlier input shape, with the signal nested under "signal". Still accepted. */
type NestedSignalInput = { why: string; signal: AgentSignal; categoryTerms?: string[] };

/**
 * Accept the earlier nested shape ({ signal: {...} }, possibly sent as text)
 * by lifting its fields to the top level. Anything else passes through.
 */
export function liftNestedSignal(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { signal, ...rest } = input as Record<string, unknown>;
  if (signal === undefined) return input;
  const inner = unpackText(signal);
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return input;
  return { ...(inner as Record<string, unknown>), ...rest };
}

export function recordSignal(ws: Workspace, raw: z.infer<typeof TOOL_INPUTS.record_signal> | NestedSignalInput): ToolOutcome {
  const input = ("signal" in raw ? { ...raw.signal, why: raw.why, categoryTerms: raw.categoryTerms } : raw) as z.infer<typeof TOOL_INPUTS.record_signal>;
  const filed = ws.addSignal(toSignalDraft(input), input.categoryTerms ?? []);
  if (!filed.ok) return fail(filed.problem);
  if (input.role) ws.signalRoles.set(filed.signalId, input.role);
  const ledger = ws.ledger()!;
  const signal = ledger.signals.find((s) => s.id === filed.signalId)!;
  const own = ledger.observations.filter((o) => o.signalId === signal.id);
  const independent = independentOrigins(own);
  const flags: string[] = [];
  const dropped = input.observations.length - signal.observationIds.length;
  if (dropped > 0) flags.push(`${dropped} of ${input.observations.length} observation(s) didn't hold up against the quotes and became inferences.`);
  if (signal.observationIds.length === 0) flags.push("No quoted observations survived, so this signal can't directly support an idea.");
  const supports = routesSupported(signal.freshness);
  if (signal.freshness.status !== "fresh") {
    flags.push(
      `Not fresh: ${signal.freshness.reason || "no date within 30 days"}. ${
        supports === "proven" ? "It can still carry a proven idea (dated by behavior or publication within 90 days)." : "It can't carry a primed or proven idea; use it as context."
      }`,
    );
  }
  if (own.length > 0 && independent === 0) flags.push("Its only sources are owned by the brand or the platform, so none counts as independent.");
  const result = `Filed ${signal.id} "${signal.name}": ${signal.observationIds.length} quoted observation(s), ${signal.freshness.status}${
    signal.freshness.ageDays != null ? ` (${signal.freshness.ageDays} days)` : ""
  }, ${independent} independent source(s), ${{ "primed-and-proven": "can carry primed or proven", proven: "can carry proven only", context: "context only" }[supports]}.`;
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

export function hypothesize(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.hypothesize>): ToolOutcome {
  const { added, problem } = ws.addHypotheses(input.hypotheses.slice(0, 3));
  if (added.length === 0) return fail(problem ?? "Give at least one hypothesis.");
  const flags = problem ? [problem] : [];
  return {
    ok: true,
    forAgent: { ok: true, added: added.map((h) => ({ id: h.id, statement: h.statement })), flags },
    result: `Recorded ${added.map((h) => `${h.id} "${h.statement}"`).join("; ")}.`,
    flags,
    changedCourse: null,
    ending: null,
  };
}

export function settleHypothesis(ws: Workspace, input: z.infer<typeof TOOL_INPUTS.settle_hypothesis>): ToolOutcome {
  const done = ws.settleHypothesis(input.id, input.verdict, input.evidence, input.note);
  if (!done.ok) return fail(done.problem);
  const h = done.hypothesis;
  const cites = h.evidence.length ? ` (${h.evidence.join(", ")})` : "";
  return {
    ok: true,
    forAgent: { ok: true, id: h.id, status: h.status },
    result: `${h.id} ${h.status}${cites}: ${h.note}`,
    flags: [],
    changedCourse: h.status === "refuted" || h.status === "dropped" ? `${h.status === "refuted" ? "Refuted" : "Dropped"} ${h.id}: "${h.statement}"` : null,
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
  const afterReview = ws.finalists().some((d) => d.assessment);
  const { added, problem } = ws.addIdeas(checked.value);
  if (added.length === 0) return fail(problem ?? "No ideas were added.");
  const flags = problem ? [problem] : [];
  return {
    ok: true,
    forAgent: { ok: true, added: added.map((i) => ({ id: i.id, headline: i.headline, basis: i.basis, groundedIn: i.groundedIn })), ideaWallSize: ws.wall.length, flags },
    result: `Added ${added.length} idea(s) (${added.map((i) => i.id).join(", ")}); the idea wall has ${ws.wall.length}.`,
    flags,
    changedCourse: afterReview ? "Went back to the idea wall after a review." : null,
    ending: null,
  };
}

type DevelopInput = Omit<z.infer<typeof TOOL_INPUTS.develop>, "route" | "reachThesis"> & Partial<Pick<z.infer<typeof TOOL_INPUTS.develop>, "route" | "reachThesis">>;

export function develop(ws: Workspace, input: DevelopInput): ToolOutcome {
  const checked = validateRevisedCandidate(input.treatment);
  if (!checked.ok) return fail(`The treatment didn't pass the format checks: ${checked.problems.slice(0, 4).join("; ")}`);
  const rewriting = !!ws.currentVersion(input.ideaId);
  const done = ws.develop(input.ideaId, checked.value, input.why, { route: input.route, reach: input.reachThesis });
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
export function finish(ws: Workspace, input: Omit<z.infer<typeof TOOL_INPUTS.finish>, "routeDecision"> & { routeDecision?: string }): ToolOutcome {
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
    reason: winnerId ? "The agent finished and code picked the winner from the review panel's scores." : "The agent finished, but no reviewed idea cleared the bar.",
    tieJudgment,
    revisionDecision: input.revisionDecision.trim() || null,
    comparison: input.comparison.trim() || null,
    routeDecision: input.routeDecision?.trim() || null,
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
  const ending: Ending = { how: "abstained", reason, tieJudgment: null, revisionDecision: null, comparison: null, routeDecision: null };
  ws.end(ending);
  return { ok: true, forAgent: { ok: true }, result: `Abstained: ${reason}`, flags: [], changedCourse: null, ending };
}

/**
 * When the run is stopped by a limit, code finishes it with no further AI
 * call: the best idea already reviewed wins, if any cleared the bar.
 */
export function forceFinish(ws: Workspace, why: string): { winnerId: string | null; ending: Ending } {
  const { leaderId } = ws.ranking();
  const ending: Ending = {
    how: "stopped",
    reason: leaderId
      ? `${why} Code finished the scan with the best idea already scored.`
      : `${why} No scored idea cleared the bar, so there's no recommendation.`,
    tieJudgment: null,
    revisionDecision: null,
    comparison: null,
    routeDecision: null,
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
      rankingValue: Math.round(rankValue(s, AGENT_HEAD_START)),
      kind: s.kind,
      rank: s.rank,
      rejected: s.rejected,
      rejectionReasons: s.rejectionReasons.map((r) => r.message),
      criteria: d.assessment!.results.map((r) => ({ id: r.criterionId, score: r.score, rationale: r.rationale })),
      makeableNote: d.assessment!.makeableNote,
    };
  });
}
