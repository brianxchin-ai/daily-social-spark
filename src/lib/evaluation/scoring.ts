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
 */

export type CriterionId =
  | "culturalRelevance"
  | "remixability"
  | "comprehension"
  | "audioPortability"
  | "brandPlatformFit"
  | "crossPlatform";

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
    weight: 0.3,
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
    id: "remixability",
    name: "Remixability and repeatability",
    weight: 0.2,
    question: "Can the underlying creative mechanic support multiple compelling interpretations and executions?",
    basis: "concept",
    anchors: {
      1: "A one-off; hard to reinterpret.",
      3: "Some variations, but they feel samey.",
      5: "One mechanic, many distinct and compelling versions.",
    },
  },
  {
    id: "comprehension",
    name: "Immediate comprehension",
    weight: 0.15,
    question: "Can audiences quickly understand the concept or creative mechanic?",
    basis: "concept",
    anchors: {
      1: "Needs explaining.",
      3: "Clear within a few seconds.",
      5: "Instantly obvious, even with the sound off.",
    },
  },
  {
    id: "audioPortability",
    name: "Creative portability beyond specific audio",
    weight: 0.1,
    question:
      "Does the opportunity remain recognizable and compelling without depending on one particular song, sound, or audio track?",
    basis: "concept",
    // Judges dependence on a specific existing song, sound or track, not the
    // mere presence of audio. Original narration, voiceover or dialogue is not
    // a dependency.
    anchors: {
      1: "The mechanic only works with one specific song, sound or track; replacing it breaks the idea.",
      3: "Leans on a particular sound's style or meme, but stays recognizable with alternatives.",
      5: "No dependence on any particular track; works with original narration, dialogue, any audio, or none.",
    },
  },
  {
    id: "brandPlatformFit",
    name: "Brand/category + platform fit",
    weight: 0.2,
    question:
      "Can the opportunity be credibly adapted to the user's selected brand or category, and does it feel native to their selected platform?",
    basis: "concept",
    anchors: {
      1: "Forced or off-brand, or feels non-native to the platform.",
      3: "Plausible with effort.",
      5: "Natural for the brand and native to the platform.",
    },
  },
  {
    id: "crossPlatform",
    name: "Cross-platform potential",
    weight: 0.05,
    question: "Could the underlying mechanic translate meaningfully to other social platforms?",
    basis: "concept",
    anchors: {
      1: "Locked to one platform.",
      3: "Translates with changes.",
      5: "Translates readily to other platforms.",
    },
  },
];

/** Order used to break ties: concept criteria first, as agreed, then cultural relevance. */
export const TIE_BREAK_ORDER: readonly CriterionId[] = [
  "remixability",
  "comprehension",
  "audioPortability",
  "brandPlatformFit",
  "crossPlatform",
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

export interface CandidateInput {
  candidateId: string;
  /** Position in the generator's output, used as the final tie-break. */
  generationIndex: number;
  results: CriterionResult[];
  audioRole: AudioRole;
  /** How many listed audio variations the evaluator judged meaningful (not copies). */
  meaningfulAudioVariations: number;
}

export interface RejectionReason {
  code: "below-threshold" | "fit-fails" | "audio-dependent";
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

  return {
    candidateId: input.candidateId,
    generationIndex: input.generationIndex,
    rankingScore: spark,
    relevanceVerified: input.results.find((r) => r.criterionId === "culturalRelevance")?.verified === true,
    rejected: reasons.length > 0,
    rejectionReasons: reasons,
    rank: null,
  };
}

const EPSILON = 1e-9;

/**
 * Score, reject and rank candidates. Deterministic: same input, same order.
 * Ranks by the Spark Score (all six criteria). Verification of cultural
 * relevance is a label only: no extra rule favors better-evidenced candidates.
 */
export function rankCandidates(inputs: CandidateInput[]): Ranking {
  const byId = new Map(inputs.map((i) => [i.candidateId, i]));
  const scored = inputs.map(scoreCandidate);

  const compare = (a: CandidateScore, b: CandidateScore): number => {
    if (Math.abs(a.rankingScore - b.rankingScore) > EPSILON) return b.rankingScore - a.rankingScore;
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
  const checks = [
    { rule: "Preserves the original core mechanic", passed: revisionChecks.preservesMechanic },
    { rule: "Addresses the weakness named in the critique", passed: revisionChecks.addressesWeakness },
    { rule: "Adds no unsupported cultural, momentum or performance claims", passed: revisionChecks.noUnsupportedClaims },
    { rule: "Passes the same rejection rules as the original", passed: !revised.rejected },
    // Small tolerance so exact-arithmetic gains like 5.0 never fail on rounding.
    { rule: `Improves the Spark Score by at least ${MIN_REVISION_GAIN} points`, passed: gain >= MIN_REVISION_GAIN - EPSILON },
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
    if (Math.abs(a.rankingScore - b.rankingScore) > EPSILON) continue;
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
