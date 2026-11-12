import { EngineError, MODEL, type ScanUsage } from "@/lib/engine/claude";
import { runScout } from "@/lib/engine/scout";
import { MIN_SECRET_LENGTH, signLedger } from "@/lib/research/signing";
import { PLATFORMS, type Platform } from "@/lib/types";
import { beginAttempt, identify, json, settle, usageGate } from "@/lib/usage/guard";
import { newMeter, withMeter } from "@/lib/usage/meter";

/**
 * /api/research: request 1 of a live-evidence scan (Day 3).
 *
 * Runs the Scout (web search, then filing into the evidence ledger), checks
 * the ledger in code, and returns it signed: bound to this brand, this
 * platform and an expiry, so the creative request can reject anything altered,
 * mismatched or expired. The signing secret never leaves the server.
 *
 * Off unless SPARK_ENGINE=claude, SPARK_RESEARCH=live and SPARK_LEDGER_SECRET
 * are all set. No retries.
 *
 * Public beta: each POST starts a paid scan attempt, which the usage gate
 * must allow first (daily allowance, one scan at a time, shared budget). The
 * signed handoff is bound to that attempt, so it can feed exactly one
 * creative request.
 */

// Allows deployment platforms to give this function time for live search.
export const maxDuration = 300;

function researchReady(): { ok: true; secret: string } | { ok: false; message: string } {
  if (process.env.SPARK_ENGINE !== "claude") return { ok: false, message: "Live research needs the Claude engine (SPARK_ENGINE=claude)." };
  if (process.env.SPARK_RESEARCH !== "live") return { ok: false, message: "Live research is off. Set SPARK_RESEARCH=live to enable it." };
  const secret = process.env.SPARK_LEDGER_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, message: "Live research is disabled: the server's ledger signing secret isn't set up." };
  }
  return { ok: true, secret };
}

/** GET: whether live research is available (never reveals settings or secrets). */
export async function GET() {
  const ready = researchReady();
  return Response.json(ready.ok ? { research: "live", model: MODEL } : { research: "off", reason: ready.message });
}

/** POST: run the Scout for one brand and platform. */
export async function POST(request: Request) {
  const ready = researchReady();
  if (!ready.ok) return Response.json({ error: ready.message }, { status: 409 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const { brand, platform } = (body ?? {}) as { brand?: unknown; platform?: unknown };
  if (typeof brand !== "string" || !brand.trim() || brand.length > 120) {
    return Response.json({ error: "Enter a brand or category (up to 120 characters)." }, { status: 400 });
  }
  if (!PLATFORMS.some((p) => p.id === platform)) {
    return Response.json({ error: "Unknown platform." }, { status: 400 });
  }
  const scan = { brand: brand.trim(), platform: platform as Platform };

  // Usage limits come before any paid call.
  const gate = usageGate();
  const who = identify(request);
  const begin = await beginAttempt(gate, who, true);
  if (!begin.ok) return json(begin.body, { status: begin.status, who });
  const attemptId = begin.attemptId;

  const meter = newMeter();
  try {
    const now = new Date();
    // request.signal fires if the person cancels: the Scout stops and makes no further calls.
    const { ledger, usages } = await withMeter(meter, () => runScout(scan, now, request.signal));
    const usage = summarize(usages);
    // Carry the research cost inside the signed ledger so the result can report the whole scan.
    ledger.researchUsage = usage;
    const { token, expiresAt } = signLedger(ledger, { ...scan, attempt: attemptId ?? undefined }, ready.secret, now);
    await settle(gate, begin, meter, true);
    console.info(
      `[research] sources=${ledger.sources.length} signals=${ledger.signals.length} observations=${ledger.observations.length} searches=${usage.webSearches} total=$${usage.estimatedCostUsd.toFixed(4)}`,
    );
    return json({ ledger, token, expiresAt, usage, attemptId }, { who });
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("Unexpected server error.", 500);
    if (!(error instanceof EngineError)) console.warn("[research] unexpected error");
    // Canceled: the attempt ends here. Failed: the creative request may still
    // follow (as an unverified hypothesis) within this same attempt.
    const canceled = safe.status === 499 || request.signal.aborted;
    await settle(gate, begin, meter, !canceled);
    const billed = error instanceof EngineError && error.usage ? summarize([error.usage]) : null;
    return json({ error: safe.message, usage: billed, attemptId: canceled ? null : attemptId }, { status: safe.status, who });
  }
}

function summarize(calls: ScanUsage[]) {
  return {
    calls: calls.map(({ step, model, inputTokens, outputTokens, estimatedCostUsd, webSearches }) => ({
      step,
      model,
      inputTokens,
      outputTokens,
      webSearches: webSearches ?? 0,
      estimatedCostUsd,
    })),
    webSearches: calls.reduce((s, c) => s + (c.webSearches ?? 0), 0),
    estimatedCostUsd: calls.reduce((s, c) => s + c.estimatedCostUsd, 0),
  };
}
