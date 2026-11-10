import { EngineError, generateCandidates, MODEL, type ScanUsage } from "@/lib/engine/claude";
import { generateDemoSpark } from "@/lib/engine/demo";
import { evaluateCandidates } from "@/lib/engine/evaluator";
import { refineLeader } from "@/lib/engine/refine";
import { rankCandidates } from "@/lib/evaluation/scoring";
import {
  PLATFORMS,
  type Candidate,
  type CandidateEvaluation,
  type EngineMode,
  type GenerationInfo,
  type HypothesisSpark,
  type Platform,
  type Spark,
} from "@/lib/types";

/**
 * /api/scan: the server-side doorway between the page and the engine.
 *
 * The engine is chosen explicitly with SPARK_ENGINE ("demo" by default).
 * In "claude" mode a scan is: generator call (3 candidates) → separate
 * evaluator call (anonymized, shuffled) → deterministic scoring and ranking
 * in our code → one bounded refinement (editor call, and a rescore call only
 * if a revision was written). Generator or evaluator failures are reported as
 * errors; refinement failures keep the evaluated leader. Demo content is never
 * substituted.
 */

function engineMode(): EngineMode {
  return process.env.SPARK_ENGINE === "claude" ? "claude" : "demo";
}

/** GET: which engine is active, so the page can label itself honestly. */
export async function GET() {
  const engine = engineMode();
  return Response.json({ engine, model: engine === "claude" ? MODEL : null });
}

/** POST: run one scan and return a finished result. */
export async function POST(request: Request) {
  const engine = engineMode();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ engine, error: "Request body must be JSON." }, { status: 400 });
  }

  const { brand, platform } = (body ?? {}) as { brand?: unknown; platform?: unknown };
  if (typeof brand !== "string" || !brand.trim() || brand.length > 120) {
    return Response.json({ engine, error: "Enter a brand or category (up to 120 characters)." }, { status: 400 });
  }
  if (!PLATFORMS.some((p) => p.id === platform)) {
    return Response.json({ engine, error: "Unknown platform." }, { status: 400 });
  }
  const scan = { brand: brand.trim(), platform: platform as Platform };

  if (engine === "demo") {
    const spark: Spark = await generateDemoSpark(scan);
    return Response.json({ engine, spark });
  }

  try {
    const stamp = Date.now();

    // 1. Generator: three distinct candidates (one call).
    const generated = await generateCandidates(scan);
    const candidates: Candidate[] = generated.candidates.map((draft, i) => ({
      id: `cand-${stamp}-${i + 1}`,
      ...draft,
    }));

    // 2. Evaluator: a separate call, anonymized and shuffled.
    const evaluated = await evaluateCandidates(
      scan,
      candidates.map((c, i) => ({ id: c.id, draft: generated.candidates[i] })),
    );

    // 3. Our code: scoring arithmetic, rejection rules, ranking, tie-breaks.
    const ranking = rankCandidates(
      evaluated.assessments.map((a) => {
        const audioRole = candidates.find((c) => c.id === a.candidateId)!.audioRole;
        return {
          candidateId: a.candidateId,
          generationIndex: candidates.findIndex((c) => c.id === a.candidateId),
          results: a.results,
          audioRole,
          meaningfulAudioVariations: a.meaningfulAudioVariations,
        };
      }),
    );

    const evaluations: CandidateEvaluation[] = ranking.scores.map((score) => {
      const assessment = evaluated.assessments.find((a) => a.candidateId === score.candidateId)!;
      return {
        candidateId: score.candidateId,
        evaluatorLabel: assessment.label,
        results: assessment.results,
        meaningfulAudioVariations: assessment.meaningfulAudioVariations,
        score,
      };
    });

    // 4. One bounded refinement of the leader: critique, at most one revision,
    //    rescore, and a deterministic keep/replace decision. Never fails the scan.
    const refined = await refineLeader(scan, candidates, evaluations, ranking.leaderId);

    const spark: HypothesisSpark = {
      id: `ai-${scan.platform}-${stamp}`,
      origin: "ai-hypothesis",
      generatedAt: new Date().toISOString(),
      brand: scan.brand,
      platform: scan.platform,
      candidates,
      evaluation: {
        mode: ranking.scores[0]?.mode ?? "concept",
        evaluations,
        leaderId: ranking.leaderId,
        leaderEvidenceBacked: ranking.leaderEvidenceBacked,
      },
      refinement: refined.refinement,
      finalCandidate: refined.finalCandidate,
      generation: summarize([generated.usage, evaluated.usage, ...refined.usages]),
    };

    console.info(
      `[scan] ranked ${evaluations.map((e) => `${e.evaluatorLabel}=${e.score.applicableScore.toFixed(2)}${e.score.rejected ? "(rejected)" : ""}`).join(" ")} leader=${ranking.leaderId ?? "none"} total=$${spark.generation.estimatedCostUsd.toFixed(4)}`,
    );
    return Response.json({ engine, spark });
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("Unexpected server error.", 500);
    if (!(error instanceof EngineError)) console.warn("[scan] unexpected error during scan");
    return Response.json({ engine, error: safe.message }, { status: safe.status });
  }
}

function summarize(calls: ScanUsage[]): GenerationInfo {
  return {
    model: calls[0]?.model ?? MODEL,
    calls: calls.map(({ step, model, inputTokens, outputTokens, estimatedCostUsd }) => ({
      step,
      model,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
    })),
    inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
    outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
    estimatedCostUsd: calls.reduce((s, c) => s + c.estimatedCostUsd, 0),
  };
}
