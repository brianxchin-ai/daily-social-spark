import "server-only";

import { audienceLine } from "@/lib/prompts/audience";
import { relevanceResult } from "@/lib/evaluation/evidence";
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
Walkthrough of one execution: ${c.walkthrough}
Why it could spread: ${c.whyItWillSpread}
Audience connection (writer's claim): ${c.audienceConnection || "none given"}
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
 * - Cultural relevance is the reviewer's judgment; code adds only a "verified" label.
 */
export function toResults(e: Assessment, ledger: EvidenceLedger | null, groundedIn: string[]): CriterionResult[] {
  return CRITERIA.map((c): CriterionResult => {
    switch (c.id) {
      case "culturalRelevance":
        return relevanceResult(e.culturalRelevance, ledger, groundedIn);
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
Platform: ${platformLabel(request.platform)}${audienceLine(request.audience)}

${ledger ? ledgerDigest(ledger) : "No evidence ledger for this scan: judge cultural relevance from your general knowledge (judgedFrom: general-knowledge)."}

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
    ledger: EvidenceLedger | null;
  },
  timeoutMs = 90_000,
  signal?: AbortSignal,
): Promise<{
  results: CriterionResult[];
  meaningfulAudioVariations: number;
  checks: RevisionChecks;
  checksRationale: string;
  usage: ScanUsage;
}> {
  const { original, revised, weakness, groundedIn, ledger } = input;
  const user = `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}${audienceLine(request.audience)}

${ledger ? ledgerDigest(ledger) : "No evidence ledger for this scan."}

${describeCandidate("A", revised, groundedIn)}

Score candidate A on its own merits, on every criterion including cultural relevance.

Candidate A is a revision of an earlier idea:
- Original core mechanic: ${original.mechanic}
- Original concept: ${original.concept}
- Weakness the revision was meant to fix: ${weakness}
preservesMechanic: does A keep the same core creative mechanic?
addressesWeakness: does A genuinely address that weakness?
introducesUnsupportedClaims: does A add factual cultural or performance claims (statistics, sources, trend data) that nothing supports?`;

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

  // The revision keeps the original's signals, so its relevance can be verified against them.
  const results = toResults(value, ledger, groundedIn);

  return {
    results,
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
