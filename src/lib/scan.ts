import type { EngineMode, ScanRequest, Spark } from "@/lib/types";

/**
 * The page's side of a scan. It never generates content itself: it asks our
 * own server routes, which run whichever engine SPARK_ENGINE selects.
 * If that fails, the error is shown. Nothing is substituted.
 *
 * Day 3: when live research is on, a scan is two requests. First
 * /api/research returns a signed evidence ledger; then /api/scan receives it.
 * The browser only carries the signed handoff; the server re-checks it. If
 * research fails, the scan still runs and is labeled unverified, with the reason.
 */

/** Progress steps shown while waiting, per engine. */
export const SCAN_STEPS: Record<EngineMode, readonly string[]> = {
  demo: ["Reading platform signals", "Checking sources", "Scoring momentum", "Drafting recommendations"],
  claude: [
    "Researching live public evidence, if enabled",
    "Generating three candidates",
    "Evaluating with a separate reviewer",
    "Ranking with the weighted framework",
    "Critiquing the leading idea",
    "Revising and rescoring, if justified",
  ],
};

/** Roughly how long each engine takes, used only to pace the progress bar. */
export const EXPECTED_SCAN_MS: Record<EngineMode, number> = { demo: 3200, claude: 150_000 };

/** Per-request ceilings: longer than each server request's own time budget. */
const RESEARCH_TIMEOUT_MS = 5 * 60_000;
const SCAN_TIMEOUT_MS = 5 * 60_000;

export class ScanError extends Error {}

export interface EngineStatus {
  engine: EngineMode;
  model: string | null;
}

/** Ask the server which engine is active. */
export async function fetchEngineStatus(): Promise<EngineStatus> {
  const response = await fetch("/api/scan", { cache: "no-store" });
  if (!response.ok) throw new ScanError("Couldn't read the engine status.");
  return (await response.json()) as EngineStatus;
}

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null; timedOut: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, payload, timedOut: false };
  } catch {
    return { ok: false, status: 0, payload: null, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request 1: research, if enabled. Returns the signed handoff, or the reason
 * there isn't one. Never throws: the creative scan continues either way.
 */
async function runResearch(request: ScanRequest): Promise<{ token: string | null; reason: string | null }> {
  const status = await fetch("/api/research", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (status?.research !== "live") return { token: null, reason: null };

  const result = await postJson("/api/research", request, RESEARCH_TIMEOUT_MS);
  const token = typeof result.payload?.token === "string" ? result.payload.token : null;
  if (result.ok && token) return { token, reason: null };
  const error = typeof result.payload?.error === "string" ? result.payload.error : null;
  return {
    token: null,
    reason: result.timedOut
      ? "Research took too long and was stopped (no retry)."
      : `Research failed${error ? `: ${error}` : "."} Nothing was retried.`,
  };
}

export async function runScan(request: ScanRequest): Promise<Spark> {
  const brand = request.brand.trim();
  if (!brand) {
    throw new ScanError("Enter a brand or category to scan.");
  }
  const scan = { brand, platform: request.platform };

  const research = await runResearch(scan);

  // Request 2: the creative workflow. No retry.
  const result = await postJson(
    "/api/scan",
    { ...scan, researchToken: research.token, researchError: research.reason },
    SCAN_TIMEOUT_MS,
  );
  if (result.status === 0) {
    throw new ScanError(
      result.timedOut
        ? "The scan took longer than 5 minutes and was stopped. Nothing was retried."
        : "Couldn't reach the app's server. Is it still running?",
    );
  }
  const spark = result.payload?.spark as Spark | undefined;
  if (!result.ok || !spark) {
    const error = typeof result.payload?.error === "string" ? result.payload.error : null;
    throw new ScanError(error ?? `The scan failed (HTTP ${result.status}).`);
  }
  if (spark.origin !== "demo" && spark.origin !== "ai-hypothesis") {
    throw new ScanError("The server returned a result in an unexpected format.");
  }
  return spark;
}
