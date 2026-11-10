import "server-only";

import { decideRevision, MIN_REVISION_GAIN, scoreCandidate, type RevisionDecision } from "@/lib/evaluation/scoring";
import type { CandidateDraft } from "@/lib/spark-schema";
import type { Candidate, CandidateEvaluation, RefinementReport, ScanRequest } from "@/lib/types";
import { EngineError, type ScanUsage } from "./claude";
import { critiqueAndRevise } from "./editor";
import { rescoreRevision } from "./evaluator";

const notRevised = (rule: string): RevisionDecision => ({
  outcome: "kept-original",
  gain: null,
  minGain: MIN_REVISION_GAIN,
  checks: [{ rule, passed: false }],
});

/** A candidate without its id: the shape the model reads and writes. */
function toDraft(candidate: Candidate): CandidateDraft {
  const draft: Partial<Candidate> = { ...candidate };
  delete draft.id;
  return draft as CandidateDraft;
}

function safeMessage(error: unknown): string {
  return error instanceof EngineError ? error.message : "An unexpected error stopped this step.";
}

/**
 * Checkpoint 4: one bounded refinement of the leader.
 * Exactly one critique, at most one revision, at most one rescore. No loops,
 * no retries. If a step fails, the already-evaluated leader stands.
 */
export async function refineLeader(
  scan: ScanRequest,
  candidates: Candidate[],
  evaluations: CandidateEvaluation[],
  leaderId: string | null,
): Promise<{ refinement: RefinementReport; finalCandidate: Candidate | null; usages: ScanUsage[] }> {
  if (!leaderId) {
    return {
      refinement: {
        status: "skipped",
        reason: "No candidate cleared the bar, so nothing was critiqued or revised.",
      },
      finalCandidate: null,
      usages: [],
    };
  }

  const leader = candidates.find((c) => c.id === leaderId)!;
  const leaderEvaluation = evaluations.find((e) => e.candidateId === leaderId)!;
  const usages: ScanUsage[] = [];

  // Step 1: critique (and, if justified, one revision).
  let edited;
  try {
    edited = await critiqueAndRevise(scan, toDraft(leader), leaderEvaluation.results);
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
      refinement: {
        status: "complete",
        originalId: leader.id,
        critique,
        revision: null,
        decision: notRevised("Editor judged a revision justified"),
      },
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
        revision: {
          candidate: null,
          validationProblems: edited.revision.problems,
          evaluation: null,
          checks: null,
          checksRationale: null,
        },
        decision: notRevised("Revision passes our format rules"),
      },
      finalCandidate: leader,
      usages,
    };
  }

  const revised: Candidate = { id: `${leader.id}-rev`, ...edited.revision.draft };

  // Step 2: rescore the revision with the same evaluator instructions.
  let rescored;
  try {
    rescored = await rescoreRevision(scan, toDraft(leader), edited.revision.draft, critique.weakness);
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
  const decision = decideRevision(leaderEvaluation.score, revisedScore, rescored.checks);

  console.info(
    `[refine] original=${leaderEvaluation.score.applicableScore.toFixed(2)} revised=${revisedScore.applicableScore.toFixed(2)} gain=${decision.gain?.toFixed(2)} outcome=${decision.outcome}`,
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
      },
      decision,
    },
    finalCandidate: decision.outcome === "kept-revised" ? revised : leader,
    usages,
  };
}
