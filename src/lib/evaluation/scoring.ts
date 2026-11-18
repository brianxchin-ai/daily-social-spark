/**
 * Daily Social Spark evaluation framework: criteria, weights and every
 * calculation. All arithmetic, normalization, rejection and ranking happen
 * here, in deterministic code. The model only supplies per-criterion 1–5
 * scores and rationales; it never computes totals or decides winners.
 *
 * Criteria, weights and questions are the user's framework, verbatim.
 * Do not add, remove or reweight criteria without the user's approval.
 *
 * Day 5 (approved by the user): Emerging Momentum was removed and its weight
 * redistributed. Cultural Relevance is now always scored by AI judgment; the
 * research can additionally verify it, which changes its label, not its score.
 * Every criterion is always scored, so there are no placeholders and one score.
 *
 * Day 5, later (approved by the user): the rubric was rebuilt around organic
 * distribution. Stop power, watch-through and shareability were added;
 * comprehension folded into stop power; remixability became participation;
 * cross-platform potential was dropped; audio dependence is now a rejection
 * rule only; and every idea must be makeable on a phone in a day.
 */

export type CriterionId =
  | "culturalRelevance"
  | "stopPower"
  | "watchThrough"
  | "shareability"
  | "participation"
  | "brandPlatformFit";

/**
 * "concept": judged from the idea itself.
 * "evidence": judged by the AI from the research and its cultural knowledge;
 * the research can also verify it (a label, never a different score).
 */
export type CriterionBasis = "concept" | "evidence";

export interface Criterion {
  id: CriterionId;
  name: string;
  /** Share of the full framework, 0–1. All six sum to 1. */
  weight: number;
  question: string;
  basis: CriterionBasis;
  /** What a 1, 3 and 5 look like, given to the evaluator for calibration. */
  anchors: { 1: string; 3: string; 5: string };
}

export const CRITERIA: readonly Criterion[] = [
  {
    id: "culturalRelevance",
    name: "Cultural relevance",
    weight: 0.2,
    question:
      "How relevant is the opportunity to current culture, conversations, behaviors, and emerging creative expression?",
    basis: "evidence",
    anchors: {
      1: "Disconnected from current conversation.",
      3: "Tied to a broad, familiar theme.",
      5: "Expresses a specific, live cultural behavior or tension.",
    },
  },
  {
    id: "stopPower",
    name: "Stop power",
    weight: 0.2,
    question: "Does the first second stop the scroll and make the idea instantly clear, even with the sound off?",
    basis: "concept",
    anchors: {
      1: "A slow or confusing start; easy to scroll past.",
      3: "A decent opening, clear within a few seconds.",
      5: "An instant, intriguing hook that's clear even on mute.",
    },
  },
  {
    id: "shareability",
    name: "Shareability",
    weight: 0.2,
    question:
      "Would people send it to a friend, tag someone, or save it for later? (Social currency, relatability, usefulness.)",
    basis: "concept",
    anchors: {
      1: "Nothing worth passing on or keeping.",
      3: "Mildly relatable or useful.",
      5: "People would immediately send it, tag someone or save it.",
    },
  },
  {
    id: "watchThrough",
    name: "Watch-through and payoff",
    weight: 0.15,
    question: "Does the structure hold attention to the end and reward a rewatch or a full swipe?",
    basis: "concept",
    anchors: {
      1: "Front-loaded; nothing pulls viewers to the end.",
      3: "Holds attention, with a modest payoff.",
      5: "Builds to a payoff worth waiting for, and invites a rewatch or a full swipe.",
    },
  },
  {
    id: "participation",
    name: "Participation",
    weight: 0.1,
    question: "Can people easily copy, stitch, remix or answer it with their own version?",
    basis: "concept",
    anchors: {
      1: "A one-off; hard to join in.",
      3: "Some ways to join in, but the versions feel samey.",
      5: "An easy, open template for many distinct versions.",
    },
  },
  {
    id: "brandPlatformFit",
    name: "Brand, platform and audience fit",
    weight: 0.15,
    question:
      "Can the opportunity be credibly adapted to the user's selected brand or category (and audience, if given), and does it feel native to their selected platform?",
    basis: "concept",
    anchors: {
      1: "Forced or off-brand, or feels non-native to the platform.",
      3: "Plausible with effort.",
      5: "Natural for the brand and native to the platform.",
    },
  },
];

/** Order used to break ties: the distribution criteria first, then participation, fit and relevance. */
export const TIE_BREAK_ORDER: readonly CriterionId[] = [
  "shareability",
  "stopPower",
  "watchThrough",
  "participation",
  "brandPlatformFit",
  "culturalRelevance",
];

export const PASS_THRESHOLD = 50; // Spark Score out of 100
export const MIN_AUDIO_VARIATIONS = 3;

export type CriterionStatus = "scored" | "unverified";

export interface CriterionResult {
  criterionId: CriterionId;
  status: CriterionStatus;
  /** Integer 1–5 when scored; null only if a criterion couldn't be scored at all. */
  score: number | null;
  rationale: string;
  /** Brand/category + platform fit only: the two parts, judged separately (the criterion takes the lower). */
  parts?: { brand: number; platform: number };
  /** Cultural relevance only: the ledger observations the reviewer cited. */
  observationIds?: string[];
  /** Cultural relevance only: true when the research meets the evidence bar. A label; the score is the AI's. */
  verified?: boolean;
  /** Cultural relevance only: what the AI's judgment leaned on. */
  judgedFrom?: "research" | "general-knowledge" | "both";
}

export type AudioRole = "audio-led" | "audio-optional" | "no-audio";

/**
 * Day 5: what an idea rests on.
 * - fresh-trend: built on a research trend whose newest evidence is recent.
 * - original: an original format, deliberately not built on any trend.
 * - stale-trend: claims a trend, but no fresh research backs it. Always rejected.
 * Fresh trend ideas get a FRESH_TREND_HEAD_START for ranking only, so an
 * original format wins when it's clearly stronger, not on a near-tie.
 */
export type IdeaKind = "fresh-trend" | "original" | "stale-trend";

/** Ranking-only bonus for fresh trend ideas, in Spark Score points. The displayed score never includes it. */
export const FRESH_TREND_HEAD_START = 5;

/** The value candidates are ranked by: the Spark Score, plus the head start for a fresh trend idea. */
export function rankValue(score: Pick<CandidateScore, "rankingScore" | "kind">): number {
  return score.rankingScore + (score.kind === "fresh-trend" ? FRESH_TREND_HEAD_START : 0);
}

export interface CandidateInput {
  candidateId: string;
  /** Position in the generator's output, used as the final tie-break. */
  generationIndex: number;
  results: CriterionResult[];
  audioRole: AudioRole;
  /** How many listed audio variations the evaluator judged meaningful (not copies). */
  meaningfulAudioVariations: number;
  kind: IdeaKind;
  /** The reviewer judged it makeable on a phone by one or two people in a day. */
  makeable: boolean;
  /** Set when it repeats an idea this visitor was already shown (Day 5). */
  repeatOf?: { headline: string; at: string } | null;
}

export interface RejectionReason {
  code: "below-threshold" | "fit-fails" | "audio-dependent" | "stale-trend" | "not-makeable" | "repeat";
  message: string;
}

export interface CandidateScore {
  candidateId: string;
  generationIndex: number;
  /**
   * The Spark Score: all six criteria at their weights, 0–100, unrounded.
   * It ranks candidates, sets the pass bar and judges revisions.
   */
  rankingScore: number;
  /** Cultural relevance is verified by the research (a label; it doesn't change the score). */
  relevanceVerified: boolean;
  kind: IdeaKind;
  rejected: boolean;
  rejectionReasons: RejectionReason[];
  /** 1-based among non-rejected candidates; null when rejected. */
  rank: number | null;
}

export interface Ranking {
  scores: CandidateScore[]; // in rank order: ranked first, then rejected
  leaderId: string | null; // null when every candidate was rejected
}

const BY_ID = new Map(CRITERIA.map((c) => [c.id, c]));

export function criterion(id: CriterionId): Criterion {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown criterion: ${id}`);
  return found;
}

/** Checks one candidate's results are complete and well formed. Throws on programmer error. */
function assertWellFormed(input: CandidateInput): void {
  const seen = new Set<CriterionId>();
  for (const r of input.results) {
    if (!BY_ID.has(r.criterionId)) throw new Error(`Unknown criterion: ${r.criterionId}`);
    if (seen.has(r.criterionId)) throw new Error(`Duplicate criterion: ${r.criterionId}`);
    seen.add(r.criterionId);
    if (r.status !== "scored" || r.score === null || !Number.isInteger(r.score) || r.score < 1 || r.score > 5) {
      throw new Error(`${r.criterionId}: every criterion needs an integer score 1–5`);
    }
  }
  for (const c of CRITERIA) {
    if (!seen.has(c.id)) throw new Error(`Missing criterion: ${c.id}`);
  }
}

/**
 * Weighted average over the scored criteria, renormalized to their combined
 * weight, then mapped from the 1–5 scale onto 0–100: (avg − 1) ÷ 4 × 100.
 *
 * Uses whole-number percentage weights so the arithmetic is exact
 * (decimal weights like 0.15 drift, e.g. 100 → 100.00000000000003,
 * which could wrongly fail a candidate sitting exactly on the threshold).
 */
export function applicableScore(results: CriterionResult[]): { score: number; weight: number } {
  let weightedPct = 0; // Σ weight% × score
  let weightPct = 0; // Σ weight%
  for (const r of results) {
    if (r.status !== "scored" || r.score === null) continue;
    const pct = Math.round(criterion(r.criterionId).weight * 100);
    weightedPct += pct * r.score;
    weightPct += pct;
  }
  if (weightPct === 0) return { score: 0, weight: 0 };
  // ((weightedPct / weightPct) − 1) / 4 × 100, rearranged to divide once.
  const score = ((weightedPct - weightPct) * 25) / weightPct;
  return { score, weight: weightPct / 100 };
}

function scoreOf(input: CandidateInput, id: CriterionId): number {
  return input.results.find((r) => r.criterionId === id)?.score ?? 0;
}

/**
 * Brand/category + platform fit from its two separately judged parts: the
 * criterion takes the LOWER, so excellent fit on one can't hide poor fit on
 * the other.
 */
export function combineFit(
  brand: { score: number; rationale: string },
  platform: { score: number; rationale: string },
): CriterionResult {
  return {
    criterionId: "brandPlatformFit",
    status: "scored",
    score: Math.min(brand.score, platform.score),
    rationale: `Brand ${brand.score}/5: ${brand.rationale} Platform ${platform.score}/5: ${platform.rationale}`,
    parts: { brand: brand.score, platform: platform.score },
  };
}

/** The Spark Score: all six criteria at their weights, 0–100. */
export function sparkScoreOf(results: CriterionResult[]): number {
  return applicableScore(results).score;
}

export function scoreCandidate(input: CandidateInput): CandidateScore {
  assertWellFormed(input);
  const spark = sparkScoreOf(input.results);
  const reasons: RejectionReason[] = [];

  // Compare unrounded values; a 49.99 never sneaks through as "50".
  if (spark < PASS_THRESHOLD) {
    reasons.push({
      code: "below-threshold",
      message: `Spark Score ${spark.toFixed(1)} is below ${PASS_THRESHOLD}.`,
    });
  }
  if (scoreOf(input, "brandPlatformFit") === 1) {
    reasons.push({ code: "fit-fails", message: "Brand/category + platform fit scored 1/5." });
  }
  if (input.audioRole === "audio-led" && input.meaningfulAudioVariations < MIN_AUDIO_VARIATIONS) {
    reasons.push({
      code: "audio-dependent",
      message: `Audio-led idea with ${input.meaningfulAudioVariations} meaningful alternative execution(s); at least ${MIN_AUDIO_VARIATIONS} are required.`,
    });
  }
  if (input.repeatOf) {
    reasons.push({
      code: "repeat",
      message: `Too close to an idea this person was already shown (${input.repeatOf.at.slice(0, 10)}): "${input.repeatOf.headline}".`,
    });
  }
  if (!input.makeable) {
    reasons.push({
      code: "not-makeable",
      message: "Not makeable on a phone by one or two people in a day (needs special locations, talent, sets, effects or paid production).",
    });
  }
  if (input.kind === "stale-trend") {
    reasons.push({
      code: "stale-trend",
      message: "Built on a trend with no fresh research behind it (newest evidence older than 30 days, undated, or none).",
    });
  }

  return {
    candidateId: input.candidateId,
    generationIndex: input.generationIndex,
    rankingScore: spark,
    relevanceVerified: input.results.find((r) => r.criterionId === "culturalRelevance")?.verified === true,
    kind: input.kind,
    rejected: reasons.length > 0,
    rejectionReasons: reasons,
    rank: null,
  };
}

const EPSILON = 1e-9;

/**
 * Score, reject and rank candidates. Deterministic: same input, same order.
 * Ranks by the Spark Score (all six criteria), with a 5-point head start for
 * fresh trend ideas. Verification of cultural relevance is a label only.
 */
export function rankCandidates(inputs: CandidateInput[]): Ranking {
  const byId = new Map(inputs.map((i) => [i.candidateId, i]));
  const scored = inputs.map(scoreCandidate);

  const compare = (a: CandidateScore, b: CandidateScore): number => {
    // Fresh trend ideas carry a 5-point head start; an original wins only when clearly stronger.
    const diff = rankValue(b) - rankValue(a);
    if (Math.abs(diff) > EPSILON) return diff;
    const ia = byId.get(a.candidateId)!;
    const ib = byId.get(b.candidateId)!;
    for (const id of TIE_BREAK_ORDER) {
      const diff = scoreOf(ib, id) - scoreOf(ia, id);
      if (diff !== 0) return diff;
    }
    return a.generationIndex - b.generationIndex;
  };

  const ranked = scored.filter((s) => !s.rejected).sort(compare);
  ranked.forEach((s, i) => (s.rank = i + 1));
  const rejected = scored.filter((s) => s.rejected).sort(compare);

  const leader = ranked[0] ?? null;
  return {
    scores: [...ranked, ...rejected],
    leaderId: leader?.candidateId ?? null,
  };
}

/** Display helper: whole number, e.g. 68.75 → "69". Ranking always uses the unrounded value. */
export function formatScore(score: number): string {
  return String(Math.round(score));
}

/* ---------- Checkpoint 4: one bounded revision ---------- */

/**
 * Minimum Spark Score gain a revision needs to replace the original.
 * An initial product-design threshold, adjustable after testing; not a
 * validated measure of creative improvement.
 */
export const MIN_REVISION_GAIN = 5;

/** Yes/no checks from the independent rescoring call. */
export interface RevisionChecks {
  preservesMechanic: boolean;
  addressesWeakness: boolean;
  noUnsupportedClaims: boolean;
}

export interface RevisionDecision {
  outcome: "kept-revised" | "kept-original";
  /** Revised minus original Concept Score, unrounded; null if there was no valid revision to score. */
  gain: number | null;
  minGain: number;
  /** Every rule that applied, pass or fail, so the decision is inspectable. */
  checks: { rule: string; passed: boolean }[];
}

/**
 * Keep the revision only if every rule passes: same core mechanic, fixes the
 * named weakness, no new unsupported claims, not rejected, and a gain of at
 * least MIN_REVISION_GAIN. Otherwise keep the original. Deterministic.
 *
 * Day 6 (approved by the user after a real agent run): when the ORIGINAL was
 * rejected, clearing the rejection is itself the improvement, so the gain
 * rule becomes "doesn't lower the Spark Score". The +5 rule still applies
 * to revisions of ideas that passed.
 */
export function decideRevision(
  original: CandidateScore,
  revised: CandidateScore | null,
  revisionChecks: RevisionChecks | null,
): RevisionDecision {
  if (!revised || !revisionChecks) {
    return {
      outcome: "kept-original",
      gain: null,
      minGain: MIN_REVISION_GAIN,
      checks: [{ rule: "A valid, scored revision exists", passed: false }],
    };
  }

  const gain = revised.rankingScore - original.rankingScore;
  const clearsRejection = original.rejected;
  const checks = [
    { rule: "Preserves the original core mechanic", passed: revisionChecks.preservesMechanic },
    { rule: "Addresses the weakness named in the critique", passed: revisionChecks.addressesWeakness },
    { rule: "Adds no unsupported cultural, momentum or performance claims", passed: revisionChecks.noUnsupportedClaims },
    {
      rule: clearsRejection ? "Clears the original's rejection: passes every rejection rule" : "Passes the same rejection rules as the original",
      passed: !revised.rejected,
    },
    // Small tolerance so exact-arithmetic gains like 5.0 never fail on rounding.
    clearsRejection
      ? { rule: "Doesn't lower the Spark Score", passed: gain >= -EPSILON }
      : { rule: `Improves the Spark Score by at least ${MIN_REVISION_GAIN} points`, passed: gain >= MIN_REVISION_GAIN - EPSILON },
  ];
  return {
    outcome: checks.every((c) => c.passed) ? "kept-revised" : "kept-original",
    gain,
    minGain: MIN_REVISION_GAIN,
    checks,
  };
}

/* ---------- Day 3: explaining ties (display only; ranking is unchanged) ---------- */

export interface TieExplanation {
  /** Higher-ranked candidate of the tied pair. */
  ahead: string;
  behind: string;
  /** The shared ranking score, unrounded. */
  score: number;
  /** What broke the tie, exactly as rankCandidates does it. */
  decidedBy: { criterionId: CriterionId; ahead: number; behind: number } | "generation-order";
}

/**
 * For each pair of adjacent ranked candidates with equal ranking scores,
 * report which agreed tie-break decided their order. Mirrors rankCandidates;
 * it never changes the ranking.
 */
export function explainTies(scores: CandidateScore[], resultsById: Map<string, CriterionResult[]>): TieExplanation[] {
  const ranked = scores.filter((s) => !s.rejected && s.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const value = (id: string, c: CriterionId) => resultsById.get(id)?.find((r) => r.criterionId === c)?.score ?? 0;
  const ties: TieExplanation[] = [];
  for (let i = 0; i + 1 < ranked.length; i++) {
    const a = ranked[i];
    const b = ranked[i + 1];
    if (a.kind !== b.kind || Math.abs(a.rankingScore - b.rankingScore) > EPSILON) continue;
    const decider = TIE_BREAK_ORDER.find((c) => value(a.candidateId, c) !== value(b.candidateId, c));
    ties.push({
      ahead: a.candidateId,
      behind: b.candidateId,
      score: a.rankingScore,
      decidedBy: decider
        ? { criterionId: decider, ahead: value(a.candidateId, decider), behind: value(b.candidateId, decider) }
        : "generation-order",
    });
  }
  return ties;
}
