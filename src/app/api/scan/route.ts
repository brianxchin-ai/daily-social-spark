import { canceledError, EngineError, generateCandidates, MODEL, type ScanUsage } from "@/lib/engine/claude";
import { generateDemoSpark } from "@/lib/engine/demo";
import { evaluateCandidates } from "@/lib/engine/evaluator";
import { refineLeader, toDraft } from "@/lib/engine/refine";
import { checkDiversity } from "@/lib/evaluation/diversity";
import { checkGrounding } from "@/lib/evaluation/evidence";
import { rankCandidates } from "@/lib/evaluation/scoring";
import { MIN_SECRET_LENGTH, verifyLedger } from "@/lib/research/signing";
import {
  PLATFORMS,
  type Candidate,
  type CandidateEvaluation,
  type EngineMode,
  type GenerationInfo,
  type HypothesisSpark,
  type Platform,
  type ResearchOutcome,
  type ScanRequest,
  type Spark,
} from "@/lib/types";
import { allowance, beginAttempt, beginCreative, identify, json, settle, usageGate } from "@/lib/usage/guard";
import { newMeter, withMeter } from "@/lib/usage/meter";

// Request 2 of a live-evidence scan. Each request stays under typical
// serverless limits; refinement is skipped (and labeled) if time runs short.
export const maxDuration = 300;
// SPARK_SCAN_BUDGET_MS exists only so tests can exercise the time-budget path.
const REQUEST_BUDGET_MS = Number(process.env.SPARK_SCAN_BUDGET_MS) || 270_000;

/**
 * Decide what research, if any, may inform this scan. A ledger counts as
 * verified only if its signature, brand, platform and expiry all check out;
 * anything else is never treated as trustworthy research.
 */
function resolveResearch(
  token: unknown,
  reason: unknown,
  scan: ScanRequest & { attempt?: string },
  now: Date,
): ResearchOutcome {
  const secret = process.env.SPARK_LEDGER_SECRET ?? "";
  const live = process.env.SPARK_RESEARCH === "live" && secret.length >= MIN_SECRET_LENGTH;
  if (!live) return { status: "off", reason: "Live research isn't enabled, so this is an unverified creative hypothesis." };
  if (token === undefined || token === null || token === "") {
    const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : "No research was provided for this scan.";
    return { status: "unavailable", reason: why };
  }
  const verified = verifyLedger(token, scan, secret, now);
  if (!verified.ok) return { status: "rejected", reason: `${verified.message} It was not used.` };
  if (verified.ledger.signals.length === 0) {
    const gap = verified.ledger.gaps[0];
    return { status: "unavailable", reason: `Research found no usable signals${gap ? `: ${gap}` : "."}` };
  }
  return { status: "verified", ledger: verified.ledger, expiresAt: verified.expiresAt };
}

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

/** GET: which engine is active, so the page can label itself honestly, plus the visitor's beta allowance. */
export async function GET(request: Request) {
  const engine = engineMode();
  if (engine !== "claude") return Response.json({ engine, model: null });
  const gate = usageGate();
  const who = identify(request);
  const left = await allowance(gate, who);
  const limits =
    gate.mode === "off"
      ? { enforced: false }
      : {
          enforced: true,
          available: gate.mode === "enforced" && left !== null,
          // Deployment check: whether a per-network identity was found (never the address itself).
          network: who.network === "local" ? "unidentified" : "identified",
          ...left,
        };
  return json({ engine, model: MODEL, limits }, { who });
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

  const { brand, platform, researchToken, researchError, attemptId } = (body ?? {}) as {
    brand?: unknown;
    platform?: unknown;
    researchToken?: unknown;
    researchError?: unknown;
    attemptId?: unknown;
  };
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

  // Usage limits come before any paid call. A scan that follows research
  // continues that attempt (once); anything else starts a new attempt.
  const gate = usageGate();
  const who = identify(request);
  const begin =
    typeof attemptId === "string" && attemptId
      ? await beginCreative(gate, who, attemptId)
      : await beginAttempt(gate, who, false);
  if (!begin.ok) return json({ engine, ...begin.body }, { status: begin.status, who });

  const meter = newMeter();
  try {
    const result = await withMeter(meter, () => runCreative(request, scan, begin.attemptId, researchToken, researchError));
    await settle(gate, begin, meter, false);
    return json({ engine, spark: result }, { who });
  } catch (error) {
    await settle(gate, begin, meter, false);
    const safe = error instanceof EngineError ? error : new EngineError("Unexpected server error.", 500);
    if (!(error instanceof EngineError)) console.warn("[scan] unexpected error during scan");
    return json({ engine, error: safe.message }, { status: safe.status, who });
  }
}

/** The creative workflow: generator → evaluator → ranking → one bounded refinement. */
async function runCreative(
  request: Request,
  scan: ScanRequest,
  attemptId: string | null,
  researchToken: unknown,
  researchError: unknown,
): Promise<HypothesisSpark> {
  const stamp = Date.now();
  const deadline = stamp + REQUEST_BUDGET_MS;
  const timeLeft = (cap: number) => Math.max(5_000, Math.min(cap, deadline - Date.now() - 5_000));

  // 0. Research: only a verified ledger counts as evidence, and only for this attempt.
  const research = resolveResearch(researchToken, researchError, { ...scan, attempt: attemptId ?? undefined }, new Date());
  const ledger = research.status === "verified" ? research.ledger : null;
  console.info(`[scan] research=${research.status}`);

  // 1. Generator: three distinct candidates (one call), grounded in the ledger when there is one.
  // request.signal fires if the person cancels: the call in progress stops and no later call starts.
  const signal = request.signal;
  const generated = await generateCandidates(scan, ledger, timeLeft(120_000), signal);
  const candidates: Candidate[] = generated.candidates.map((draft, i) => {
    const grounding = checkGrounding(draft, ledger);
    return {
      id: `cand-${stamp}-${i + 1}`,
      ...draft,
      groundedIn: grounding.groundedIn,
      contextIn: grounding.contextIn,
      groundingWarnings: grounding.warnings,
    };
  });

  // Range check: labels near-duplicates and unused off-category signals. No extra call, no retry.
  const diversity = checkDiversity(candidates, ledger);

  // 2. Evaluator: a separate call, anonymized and shuffled; evidence scores are proposals.
  const evaluated = await evaluateCandidates(
    scan,
    candidates.map((c) => ({ id: c.id, draft: toDraft(c), groundedIn: c.groundedIn })),
    ledger,
    { timeoutMs: timeLeft(90_000), signal },
  );

  // 3. Our code: evidence rules, scoring arithmetic, rejection rules, ranking.
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

  // 4. One bounded refinement of the leader, within the time budget. Never fails the scan.
  if (signal.aborted) throw canceledError("scan");
  const refined = await refineLeader(scan, candidates, evaluations, ranking.leaderId, { ledger, deadline, signal });
  if (signal.aborted) throw canceledError("scan");

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
    research,
    diversity,
  };

  console.info(
    `[scan] ranked ${evaluations.map((e) => `${e.evaluatorLabel}=${e.score.rankingScore.toFixed(2)}${e.score.provisional ? "p" : ""}/c${e.score.conceptScore.toFixed(1)}/${e.score.status}${e.score.rejected ? "(rejected)" : ""}`).join(" ")} leader=${ranking.leaderId ?? "none"} total=$${spark.generation.estimatedCostUsd.toFixed(4)}`,
  );
  return spark;
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
