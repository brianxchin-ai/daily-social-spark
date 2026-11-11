import "server-only";

import { checkGrounding } from "@/lib/evaluation/evidence";
import {
  decideRevision,
  MIN_REVISION_GAIN,
  scoreCandidate,
  type CriterionId,
  type RevisionDecision,
} from "@/lib/evaluation/scoring";
import type { EvidenceLedger } from "@/lib/research/ledger";
import type { CandidateDraft } from "@/lib/spark-schema";
import type { Candidate, CandidateEvaluation, RefinementReport, ScanRequest } from "@/lib/types";
import { EngineError, type ScanUsage } from "./claude";
import { critiqueAndRevise } from "./editor";
import { rescoreRevision } from "./evaluator";

/** Time budget: refinement starts only with this much left, and keeps a reserve for the rescore. */
export const MIN_REFINE_MS = 90_000;
const RESCORE_RESERVE_MS = 45_000;
const MIN_RESCORE_MS = 20_000;

const notRevised = (rule: string): RevisionDecision => ({
  outcome: "kept-original",
  gain: null,
  minGain: MIN_REVISION_GAIN,
  checks: [{ rule, passed: false }],
});

/** A candidate without our bookkeeping: the shape the model reads and writes. */
export function toDraft(candidate: Candidate): CandidateDraft {
  const draft: Partial<Candidate> = { ...candidate };
  delete draft.id;
  delete draft.groundingWarnings;
  return draft as CandidateDraft;
}

function safeMessage(error: unknown): string {
  return error instanceof EngineError ? error.message : "An unexpected error stopped this step.";
}

/**
 * One bounded refinement of the leader: exactly one critique, at most one
 * revision, at most one rescore. No loops, no retries. If a step fails or the
 * request's time budget runs short, the already-evaluated leader stands.
 */
export async function refineLeader(
  scan: ScanRequest,
  candidates: Candidate[],
  evaluations: CandidateEvaluation[],
  leaderId: string | null,
  context: { ledger: EvidenceLedger | null; deadline: number; signal?: AbortSignal },
): Promise<{ refinement: RefinementReport; finalCandidate: Candidate | null; usages: ScanUsage[] }> {
  if (!leaderId) {
    return {
      refinement: { status: "skipped", reason: "No candidate cleared the bar, so nothing was critiqued or revised." },
      finalCandidate: null,
      usages: [],
    };
  }

  const leader = candidates.find((c) => c.id === leaderId)!;
  const leaderEvaluation = evaluations.find((e) => e.candidateId === leaderId)!;
  const usages: ScanUsage[] = [];
  const { ledger, deadline, signal } = context;

  const remaining = deadline - Date.now();
  if (remaining < MIN_REFINE_MS) {
    return {
      refinement: {
        status: "skipped",
        reason: "Refinement was skipped: not enough time was left in this request to critique and rescore safely.",
      },
      finalCandidate: leader,
      usages,
    };
  }

  // Step 1: critique (and, if justified, one revision).
  let edited;
  try {
    edited = await critiqueAndRevise(
      scan,
      toDraft(leader),
      leaderEvaluation.results,
      Math.min(120_000, remaining - RESCORE_RESERVE_MS),
      signal,
    );
    usages.push(edited.usage);
  } catch (error) {
    if (error instanceof EngineError && error.usage) usages.push(error.usage);
    console.warn("[refine] editor step failed; keeping the evaluated leader");
    return {
      refinement: { status: "failed", step: "editor", message: safeMessage(error), critique: null },
      finalCandidate: leader,
      usages,
    };
  }
  const { critique } = edited;

  if (!edited.revision) {
    return {
      refinement: { status: "complete", originalId: leader.id, critique, revision: null, decision: notRevised("Editor judged a revision justified") },
      finalCandidate: leader,
      usages,
    };
  }

  if (!edited.revision.ok) {
    return {
      refinement: {
        status: "complete",
        originalId: leader.id,
        critique,
        revision: { candidate: null, validationProblems: edited.revision.problems, evaluation: null, checks: null, checksRationale: null },
        decision: notRevised("Revision passes our format rules"),
      },
      finalCandidate: leader,
      usages,
    };
  }

  const grounding = checkGrounding(edited.revision.draft, ledger);
  const revised: Candidate = {
    id: `${leader.id}-rev`,
    ...edited.revision.draft,
    groundedIn: grounding.groundedIn,
    contextIn: grounding.contextIn,
    groundingWarnings: grounding.warnings,
  };

  const left = deadline - Date.now();
  if (left < MIN_RESCORE_MS) {
    return {
      refinement: {
        status: "failed",
        step: "rescore",
        message: "The rescore was skipped: not enough time was left in this request.",
        critique,
      },
      finalCandidate: leader,
      usages,
    };
  }

  // Step 2: rescore the revision with the same evaluator instructions, and
  // check whether the original evidence still supports it.
  let rescored;
  try {
    rescored = await rescoreRevision(
      scan,
      {
        original: toDraft(leader),
        revised: toDraft(revised),
        weakness: critique.weakness,
        // The evidence under test is the original's: same signals, same observations.
        groundedIn: leader.groundedIn,
        originalResults: leaderEvaluation.results,
        ledger,
      },
      Math.min(90_000, left - 5_000),
      signal,
    );
    usages.push(rescored.usage);
  } catch (error) {
    if (error instanceof EngineError && error.usage) usages.push(error.usage);
    console.warn("[refine] rescore step failed; keeping the evaluated leader");
    return {
      refinement: { status: "failed", step: "rescore", message: safeMessage(error), critique },
      finalCandidate: leader,
      usages,
    };
  }

  // Step 3: our code decides, using the same rules as everything else.
  const revisedScore = scoreCandidate({
    candidateId: revised.id,
    generationIndex: candidates.length,
    results: rescored.results,
    audioRole: revised.audioRole,
    meaningfulAudioVariations: rescored.meaningfulAudioVariations,
  });
  const lostVerified = lostEvidence(leaderEvaluation.results, rescored.results);
  const decision = decideRevision(leaderEvaluation.score, revisedScore, rescored.checks, ledger ? { lostVerified } : undefined);

  console.info(
    `[refine] concept original=${leaderEvaluation.score.conceptScore.toFixed(2)} revised=${revisedScore.conceptScore.toFixed(2)} gain=${decision.gain?.toFixed(2)} lostEvidence=${lostVerified.length} outcome=${decision.outcome}`,
  );

  return {
    refinement: {
      status: "complete",
      originalId: leader.id,
      critique,
      revision: {
        candidate: revised,
        validationProblems: [],
        evaluation: {
          candidateId: revised.id,
          evaluatorLabel: "Rescore",
          results: rescored.results,
          meaningfulAudioVariations: rescored.meaningfulAudioVariations,
          score: revisedScore,
        },
        checks: rescored.checks,
        checksRationale: rescored.checksRationale,
        evidenceRationale: rescored.evidenceRationale,
      },
      decision,
    },
    finalCandidate: decision.outcome === "kept-revised" ? revised : leader,
    usages,
  };
}

/** Evidence criteria verified for the original but not for the revision. */
export function lostEvidence(
  original: { criterionId: CriterionId; status: string }[],
  revised: { criterionId: CriterionId; status: string }[],
): CriterionId[] {
  return original
    .filter((r) => r.status === "scored" && (r.criterionId === "culturalRelevance" || r.criterionId === "emergingMomentum"))
    .filter((r) => revised.find((x) => x.criterionId === r.criterionId)?.status !== "scored")
    .map((r) => r.criterionId);
}
