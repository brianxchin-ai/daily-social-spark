import "server-only";

import { evidenceResult, revisedEvidence } from "@/lib/evaluation/evidence";
import { combineFit, CRITERIA, type CriterionResult, type RevisionChecks } from "@/lib/evaluation/scoring";
import { evaluatorSystem, ledgerDigest } from "@/lib/prompts/creative";
import type { EvidenceLedger } from "@/lib/research/ledger";
import {
  EvaluationSchema,
  RescoreSchema,
  validateEvaluation,
  validateRescore,
  type CandidateDraft,
  type EvaluationDraft,
} from "@/lib/spark-schema";
import type { ScanRequest } from "@/lib/types";
import { callStructured, platformLabel, type ScanUsage } from "./claude";

const LABELS = ["A", "B", "C"] as const;
type Label = (typeof LABELS)[number];

function describeCandidate(label: Label, c: CandidateDraft, groundedIn: string[]): string {
  const ideas = c.formatIdeas.map((f) => `  - ${f.title}: ${f.hook}. ${f.description}`).join("\n");
  const audio =
    c.audioVariations.length > 0 ? c.audioVariations.map((v) => `  - ${v}`).join("\n") : "  (none listed)";
  return `CANDIDATE ${label}
Headline: ${c.headline}
Concept: ${c.concept}
Mechanic: ${c.mechanic}
Territory: ${c.territory}
Grounded in signals (direct evidence): ${groundedIn.length ? groundedIn.join(", ") : "none"}
Context only (not proof): ${c.contextIn.length ? c.contextIn.join(", ") : "none"}
Evidence basis (writer's account; check it against the ledger): ${c.evidenceBasis}
Creative leap (writer's inference): ${c.creativeLeap}
Execution hypothesis: ${c.executionHypothesis}
Platform execution: ${c.platformExecution}
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

type Assessment = Omit<EvaluationDraft["evaluations"][number], "label">;

/**
 * Turn the evaluator's answer into one result per criterion.
 * - Brand/category + platform fit takes the LOWER of the two separate scores,
 *   so excellent fit on one can't hide poor fit on the other (weights unchanged).
 * - The two evidence criteria are proposals; code decides whether they stand.
 */
export function toResults(e: Assessment, ledger: EvidenceLedger | null, groundedIn: string[]): CriterionResult[] {
  return CRITERIA.map((c): CriterionResult => {
    switch (c.id) {
      case "culturalRelevance":
      case "emergingMomentum":
        return evidenceResult(c.id, e[c.id], ledger, groundedIn);
      case "brandPlatformFit":
        return combineFit(e.brandFit, e.platformFit);
      default:
        return { criterionId: c.id, status: "scored", score: e[c.id].score, rationale: e[c.id].rationale };
    }
  });
}

/**
 * Evaluator call: a separate model call that sees the candidates anonymized
 * (A/B/C) and shuffled, plus the evidence ledger when one was verified.
 */
export async function evaluateCandidates(
  request: ScanRequest,
  candidates: { id: string; draft: CandidateDraft; groundedIn: string[] }[],
  ledger: EvidenceLedger | null,
  options: { timeoutMs?: number; random?: () => number; signal?: AbortSignal } = {},
): Promise<{ assessments: CandidateAssessment[]; usage: ScanUsage }> {
  const order = shuffled(candidates, options.random);
  const byLabel = new Map<Label, (typeof candidates)[number]>(order.map((c, i) => [LABELS[i], c]));

  const user = `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

${ledger ? ledgerDigest(ledger) : "No evidence ledger for this scan: give proposedScore 0 for cultural relevance and emerging momentum."}

${order.map((c, i) => describeCandidate(LABELS[i], c.draft, c.groundedIn)).join("\n\n")}

Evaluate candidates A, B and C.`;

  const { value, usage } = await callStructured({
    step: "evaluator",
    system: evaluatorSystem(request.platform),
    user,
    schema: EvaluationSchema,
    maxTokens: 10_000, // worst case ≈ $0.10 of output
    timeoutMs: options.timeoutMs ?? 90_000,
    validate: validateEvaluation,
    signal: options.signal,
  });

  const assessments = value.evaluations.map((e): CandidateAssessment => {
    const c = byLabel.get(e.label)!;
    return {
      candidateId: c.id,
      label: e.label,
      results: toResults(e, ledger, c.groundedIn),
      meaningfulAudioVariations: e.meaningfulAudioVariations,
    };
  });
  return { assessments, usage };
}

/**
 * Rescore a revision with the same evaluator instructions, plus yes/no checks
 * and an evidence-support check. The evaluator never sees the original's scores.
 */
export async function rescoreRevision(
  request: ScanRequest,
  input: {
    original: CandidateDraft;
    revised: CandidateDraft;
    weakness: string;
    groundedIn: string[];
    originalResults: CriterionResult[];
    ledger: EvidenceLedger | null;
  },
  timeoutMs = 90_000,
  signal?: AbortSignal,
): Promise<{
  results: CriterionResult[];
  meaningfulAudioVariations: number;
  checks: RevisionChecks;
  checksRationale: string;
  evidenceRationale: string;
  usage: ScanUsage;
}> {
  const { original, revised, weakness, groundedIn, originalResults, ledger } = input;
  const cited = originalResults.flatMap((r) => r.observationIds ?? []);
  const user = `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

${ledger ? ledgerDigest(ledger) : "No evidence ledger for this scan."}

${describeCandidate("A", revised, groundedIn)}

Score candidate A on its own merits. For cultural relevance and emerging momentum, give proposedScore 0: the original's evidence is checked separately below.

Candidate A is a revision of an earlier idea:
- Original core mechanic: ${original.mechanic}
- Original concept: ${original.concept}
- Weakness the revision was meant to fix: ${weakness}
- Evidence the original's scores rested on: ${cited.length ? cited.join(", ") : "none"}
preservesMechanic: does A keep the same core creative mechanic?
addressesWeakness: does A genuinely address that weakness?
introducesUnsupportedClaims: does A add cultural, momentum or performance claims the evidence doesn't support?
evidenceStillSupports: for each evidence criterion, does that same evidence still support A's cultural claim? Use not-applicable if no evidence was cited for it.
culturalClaimChanged: did the revision change the underlying cultural claim or signal?`;

  const { value, usage } = await callStructured({
    step: "rescore",
    system: evaluatorSystem(request.platform),
    user,
    schema: RescoreSchema,
    maxTokens: 5_000, // worst case ≈ $0.05 of output
    timeoutMs,
    validate: validateRescore,
    signal,
  });

  const concept = toResults(value, null, []).filter((r) => r.criterionId !== "culturalRelevance" && r.criterionId !== "emergingMomentum");
  const evidence = revisedEvidence(originalResults, value.evidenceStillSupports, value.culturalClaimChanged);
  const results = CRITERIA.map((c) => [...concept, ...evidence].find((r) => r.criterionId === c.id)!);

  return {
    results,
    meaningfulAudioVariations: value.meaningfulAudioVariations,
    checks: {
      preservesMechanic: value.preservesMechanic,
      addressesWeakness: value.addressesWeakness,
      noUnsupportedClaims: !value.introducesUnsupportedClaims,
    },
    checksRationale: value.checksRationale,
    evidenceRationale: value.evidenceRationale,
    usage,
  };
}
