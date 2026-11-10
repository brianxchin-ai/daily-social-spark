import "server-only";

import { CRITERIA, type CriterionId, type CriterionResult } from "@/lib/evaluation/scoring";
import {
  EvaluationSchema,
  RescoreSchema,
  validateEvaluation,
  validateRescore,
  type CandidateDraft,
  type RescoreDraft,
} from "@/lib/spark-schema";
import type { RevisionChecks } from "@/lib/evaluation/scoring";
import type { ScanRequest } from "@/lib/types";
import { callStructured, platformLabel, type ScanUsage } from "./claude";

const LABELS = ["A", "B", "C"] as const;
type Label = (typeof LABELS)[number];

/** The five criteria the evaluator scores today (judged from the concept itself). */
const CONCEPT_CRITERIA = CRITERIA.filter((c) => c.basis === "concept");

function rubric(): string {
  return CONCEPT_CRITERIA.map(
    (c) =>
      `- ${c.id}: "${c.name}". ${c.question}\n  1 = ${c.anchors[1]} 3 = ${c.anchors[3]} 5 = ${c.anchors[5]}`,
  ).join("\n");
}

const EVALUATOR_SYSTEM = `You are an independent creative reviewer for short-form social content. You did not write the candidates and you have no stake in them. Judge each one on its own merits, against the rubric only.

Score these five criteria for every candidate, as an integer from 1 to 5:
${rubric()}

General scale: 5 Exceptional (strongly meets it, almost no reservations), 4 Strong (meets it well, minor reservations), 3 Adequate (partly meets it, real gaps), 2 Weak (barely meets it), 1 Poor (fails it). Use the full range; don't default to 3 or 4.

Audio rule: audio portability measures dependence on one specific existing song, sound or audio track. Ask: would replacing that particular track fundamentally undermine the creative mechanic? Original narration, voiceover and dialogue are NOT dependencies; do not lower the score just because audio contributes to the execution. Treat dependence on one specific track as a weakness unless the mechanic stays recognizable and compelling through alternative audio, original voiceover, silence or visual reinterpretation. For each candidate built around a specific existing track, count how many of its listed audio variations genuinely preserve the mechanic without copying that track.

Do NOT score cultural relevance or emerging momentum. They cannot be verified without live research. For each, write one sentence on what live evidence would establish it.

Rules:
- Each rationale is one concise sentence of 25 words or fewer.
- Never invent statistics, sources, metrics or current platform data, or imply you have them.
- Do not total, average, rank or pick a winner. Scoring maths and ranking are done elsewhere.
- Use American English spelling (e.g. "behavior", "recognize", "favor").
- Write em dashes closed, with no spaces around them.`;

function describeCandidate(label: Label, c: CandidateDraft): string {
  const ideas = c.formatIdeas.map((f) => `  - ${f.title}: ${f.hook}. ${f.description}`).join("\n");
  const audio =
    c.audioVariations.length > 0 ? c.audioVariations.map((v) => `  - ${v}`).join("\n") : "  (none listed)";
  return `CANDIDATE ${label}
Headline: ${c.headline}
Concept: ${c.concept}
Mechanic: ${c.mechanic}
Why it could spread: ${c.whyItWillSpread}
Audio role: ${c.audioRole}
Audio variations:
${audio}
Execution ideas:
${ideas}`;
}

/** Fisher–Yates shuffle; `random` is injectable so tests can be deterministic. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface CandidateAssessment {
  candidateId: string;
  /** The anonymous label the evaluator saw. */
  label: Label;
  results: CriterionResult[];
  meaningfulAudioVariations: number;
}

/**
 * Evaluator call: a separate model call that sees only the candidates, anonymized
 * (A/B/C) and shuffled. Cultural relevance and emerging momentum are returned as
 * Unverified, with no number.
 */
export async function evaluateCandidates(
  request: ScanRequest,
  candidates: { id: string; draft: CandidateDraft }[],
  random: () => number = Math.random,
): Promise<{ assessments: CandidateAssessment[]; usage: ScanUsage }> {
  const order = shuffled(candidates, random);
  const labelToId = new Map<Label, string>(order.map((c, i) => [LABELS[i], c.id]));

  const user = `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

${order.map((c, i) => describeCandidate(LABELS[i], c.draft)).join("\n\n")}

Evaluate candidates A, B and C.`;

  const { value, usage } = await callStructured({
    step: "evaluator",
    system: EVALUATOR_SYSTEM,
    user,
    schema: EvaluationSchema,
    maxTokens: 8_000, // worst case ≈ $0.08 of output
    timeoutMs: 90_000,
    validate: validateEvaluation,
  });

  const assessments = value.evaluations.map(
    (e): CandidateAssessment => ({
      candidateId: labelToId.get(e.label)!,
      label: e.label,
      results: toResults(e),
      meaningfulAudioVariations: e.meaningfulAudioVariations,
    }),
  );

  return { assessments, usage };
}

type ScoredFields = Pick<
  RescoreDraft,
  | "remixability"
  | "comprehension"
  | "audioPortability"
  | "brandPlatformFit"
  | "crossPlatform"
  | "culturalRelevanceEvidenceNeeded"
  | "emergingMomentumEvidenceNeeded"
>;

/** Turn the evaluator's answer into one result per criterion; evidence criteria stay Unverified. */
function toResults(e: ScoredFields): CriterionResult[] {
  return CRITERIA.map((c): CriterionResult => {
    if (c.id === "culturalRelevance") {
      return { criterionId: c.id, status: "unverified", score: null, rationale: e.culturalRelevanceEvidenceNeeded };
    }
    if (c.id === "emergingMomentum") {
      return { criterionId: c.id, status: "unverified", score: null, rationale: e.emergingMomentumEvidenceNeeded };
    }
    const scored = e[c.id as Exclude<CriterionId, "culturalRelevance" | "emergingMomentum">];
    return { criterionId: c.id, status: "scored", score: scored.score, rationale: scored.rationale };
  });
}

/**
 * Rescore a revision with the same evaluator instructions and rubric, plus
 * three yes/no checks our code uses to decide whether the revision may
 * replace the original. The evaluator never sees the original's scores.
 */
export async function rescoreRevision(
  request: ScanRequest,
  original: CandidateDraft,
  revised: CandidateDraft,
  weakness: string,
): Promise<{
  results: CriterionResult[];
  meaningfulAudioVariations: number;
  checks: RevisionChecks;
  checksRationale: string;
  usage: ScanUsage;
}> {
  const user = `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

${describeCandidate("A", revised)}

Score candidate A on the five criteria, on its own merits.

Then answer three checks about candidate A, which is a revision of an earlier idea:
- Original core mechanic: ${original.mechanic}
- Original concept: ${original.concept}
- Weakness the revision was meant to fix: ${weakness}
preservesMechanic: does A keep the same core creative mechanic (not a different idea)?
addressesWeakness: does A genuinely address that weakness?
introducesUnsupportedClaims: does A add cultural, momentum or performance claims that can't be supported without live data?`;

  const { value, usage } = await callStructured({
    step: "rescore",
    system: EVALUATOR_SYSTEM,
    user,
    schema: RescoreSchema,
    maxTokens: 4_000, // worst case ≈ $0.04 of output
    timeoutMs: 90_000,
    validate: validateRescore,
  });

  return {
    results: toResults(value),
    meaningfulAudioVariations: value.meaningfulAudioVariations,
    checks: {
      preservesMechanic: value.preservesMechanic,
      addressesWeakness: value.addressesWeakness,
      noUnsupportedClaims: !value.introducesUnsupportedClaims,
    },
    checksRationale: value.checksRationale,
    usage,
  };
}
