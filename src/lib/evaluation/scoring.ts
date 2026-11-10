/**
 * Daily Social Spark evaluation framework: criteria, weights and every
 * calculation. All arithmetic, normalization, rejection and ranking happen
 * here, in deterministic code. The model only supplies per-criterion 1–5
 * scores and rationales; it never computes totals or decides winners.
 *
 * Criteria, weights and questions are the user's framework, verbatim.
 * Do not add, remove or reweight criteria without the user's approval.
 */

export type CriterionId =
  | "culturalRelevance"
  | "emergingMomentum"
  | "remixability"
  | "comprehension"
  | "audioPortability"
  | "brandPlatformFit"
  | "crossPlatform";

/** "concept": judgeable from the idea itself. "evidence": needs live research. */
export type CriterionBasis = "concept" | "evidence";

export interface Criterion {
  id: CriterionId;
  name: string;
  /** Share of the full framework, 0–1. All seven sum to 1. */
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
    weight: 0.25,
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
    id: "emergingMomentum",
    name: "Emerging momentum",
    weight: 0.25,
    question: "Is the opportunity showing signs of accelerating traction, ideally before mainstream saturation?",
    basis: "evidence",
    anchors: {
      1: "Stale or already saturated.",
      3: "Established and stable.",
      5: "Accelerating and still pre-mainstream.",
    },
  },
  {
    id: "remixability",
    name: "Remixability and repeatability",
    weight: 0.15,
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
    weight: 0.1,
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
    anchors: {
      1: "Only works with one specific track.",
      3: "Works with alternative audio, but noticeably weaker.",
      5: "Fully works with original voiceover, silence or visuals, with several non-copying variations.",
    },
  },
  {
    id: "brandPlatformFit",
    name: "Brand/category + platform fit",
    weight: 0.1,
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

/** Order used to break ties: concept criteria first, as agreed. */
export const TIE_BREAK_ORDER: readonly CriterionId[] = [
  "remixability",
  "comprehension",
  "audioPortability",
  "brandPlatformFit",
  "crossPlatform",
];

export const PASS_THRESHOLD = 50; // applicable score out of 100
export const MIN_AUDIO_VARIATIONS = 3;

export type CriterionStatus = "scored" | "unverified";

export interface CriterionResult {
  criterionId: CriterionId;
  status: CriterionStatus;
  /** Integer 1–5 when scored; null when unverified. Never a placeholder number. */
  score: number | null;
  rationale: string;
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

/**
 * "concept": only concept criteria were scored (Day 2).
 * "partial": some evidence criteria scored, some unverified.
 * "full": all seven scored with evidence.
 */
export type ScoreMode = "concept" | "partial" | "full";

export interface RejectionReason {
  code: "below-threshold" | "fit-fails" | "audio-dependent";
  message: string;
}

export interface CandidateScore {
  candidateId: string;
  generationIndex: number;
  mode: ScoreMode;
  /** Normalized 0–100 over the scored criteria, unrounded. */
  applicableScore: number;
  /** Sum of the weights the score is based on (0.5 on Day 2). */
  applicableWeight: number;
  /** True only when every evidence criterion is scored. */
  evidenceBacked: boolean;
  rejected: boolean;
  /** "provisional-creative" on Day 2; "evidence-based" once evidence exists. */
  rejectionKind: "provisional-creative" | "evidence-based" | null;
  rejectionReasons: RejectionReason[];
  /** 1-based among non-rejected candidates; null when rejected. */
  rank: number | null;
}

export interface Ranking {
  scores: CandidateScore[]; // in rank order: ranked first, then rejected
  leaderId: string | null; // null when every candidate was rejected
  /** True when the leader can be presented as evidence-backed (Day 3+). */
  leaderEvidenceBacked: boolean;
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
    if (r.status === "scored") {
      if (r.score === null || !Number.isInteger(r.score) || r.score < 1 || r.score > 5) {
        throw new Error(`${r.criterionId}: scored criteria need an integer 1–5`);
      }
    } else if (r.score !== null) {
      throw new Error(`${r.criterionId}: unverified criteria must not carry a number`);
    }
  }
  for (const c of CRITERIA) {
    if (!seen.has(c.id)) throw new Error(`Missing criterion: ${c.id}`);
    if (c.basis === "concept" && input.results.find((r) => r.criterionId === c.id)?.status !== "scored") {
      throw new Error(`${c.id}: concept criteria must always be scored`);
    }
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

function scoreMode(results: CriterionResult[]): ScoreMode {
  const evidence = results.filter((r) => criterion(r.criterionId).basis === "evidence");
  const scored = evidence.filter((r) => r.status === "scored").length;
  if (scored === 0) return "concept";
  return scored === evidence.length ? "full" : "partial";
}

function scoreOf(input: CandidateInput, id: CriterionId): number {
  return input.results.find((r) => r.criterionId === id)?.score ?? 0;
}

export function scoreCandidate(input: CandidateInput): CandidateScore {
  assertWellFormed(input);
  const { score, weight } = applicableScore(input.results);
  const mode = scoreMode(input.results);
  const evidenceBacked = mode === "full";
  const reasons: RejectionReason[] = [];

  // Compare unrounded values; a 49.99 never sneaks through as "50".
  if (score < PASS_THRESHOLD) {
    reasons.push({
      code: "below-threshold",
      message: `${mode === "concept" ? "Concept" : "Overall"} score ${score.toFixed(1)} is below ${PASS_THRESHOLD}.`,
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

  const rejected = reasons.length > 0;
  return {
    candidateId: input.candidateId,
    generationIndex: input.generationIndex,
    mode,
    applicableScore: score,
    applicableWeight: weight,
    evidenceBacked,
    rejected,
    rejectionKind: rejected ? (evidenceBacked ? "evidence-based" : "provisional-creative") : null,
    rejectionReasons: reasons,
    rank: null,
  };
}

const EPSILON = 1e-9;

/** Score, reject and rank candidates. Deterministic: same input, same order. */
export function rankCandidates(inputs: CandidateInput[]): Ranking {
  const byId = new Map(inputs.map((i) => [i.candidateId, i]));
  const scored = inputs.map(scoreCandidate);

  const compare = (a: CandidateScore, b: CandidateScore): number => {
    if (Math.abs(a.applicableScore - b.applicableScore) > EPSILON) return b.applicableScore - a.applicableScore;
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
    leaderEvidenceBacked: leader?.evidenceBacked ?? false,
  };
}

/** Display helper: whole number, e.g. 68.75 → "69". Ranking always uses the unrounded value. */
export function formatScore(score: number): string {
  return String(Math.round(score));
}
