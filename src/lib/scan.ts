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

/** Demo mode's simulated progress steps. Claude mode shows progress per real request instead. */
export const DEMO_STEPS: readonly string[] = ["Reading platform signals", "Checking sources", "Scoring momentum", "Drafting recommendations"];

/** Rough duration of request 1 (research), used only to pace the progress bar. */
export const EXPECTED_RESEARCH_MS = 55_000;

/** Roughly how long each engine takes, used only to pace the progress bar. */
export const EXPECTED_SCAN_MS: Record<EngineMode, number> = { demo: 3200, claude: 65_000 };

/** Per-request ceilings: longer than each server request's own time budget. */
const RESEARCH_TIMEOUT_MS = 5 * 60_000;
const SCAN_TIMEOUT_MS = 5 * 60_000;

export class ScanError extends Error {}

/** Thrown when the person cancels a scan. Not an error to show: the page simply resets. */
export class ScanCanceled extends Error {}

export interface EngineStatus {
  engine: EngineMode;
  model: string | null;
  /** Whether live research runs before the creative request. */
  research: "live" | "off";
}

/** Ask the server which engine is active, and whether live research is on. */
export async function fetchEngineStatus(): Promise<EngineStatus> {
  const response = await fetch("/api/scan", { cache: "no-store" });
  if (!response.ok) throw new ScanError("Couldn't read the engine status.");
  const engine = (await response.json()) as Omit<EngineStatus, "research">;
  const research = await fetch("/api/research", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return { ...engine, research: research?.research === "live" ? "live" : "off" };
}

/** Which request a live scan is waiting on. */
export type ScanPhase = "research" | "creative";

async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  cancel?: AbortSignal,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> | null; timedOut: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The person's Cancel stops the request too.
  const onCancel = () => controller.abort();
  cancel?.addEventListener("abort", onCancel);
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
    if (cancel?.aborted) throw new ScanCanceled("Scan canceled.");
    return { ok: false, status: 0, payload: null, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener("abort", onCancel);
  }
}

/**
 * Request 1: research, if enabled. Returns the signed handoff, or the reason
 * there isn't one. Never throws: the creative scan continues either way.
 */
async function runResearch(
  request: ScanRequest,
  cancel?: AbortSignal,
): Promise<{ token: string | null; reason: string | null }> {
  const status = await fetch("/api/research", { cache: "no-store", signal: cancel })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (cancel?.aborted) throw new ScanCanceled("Scan canceled.");
  if (status?.research !== "live") return { token: null, reason: null };

  const result = await postJson("/api/research", request, RESEARCH_TIMEOUT_MS, cancel);
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

/**
 * Run one scan. Passing `cancel` lets the person stop it: the request in
 * flight is abandoned, the next request never starts, and ScanCanceled is
 * thrown. A server request already under way may finish on its own; its
 * result is discarded.
 */
export async function runScan(
  request: ScanRequest,
  onPhase?: (phase: ScanPhase) => void,
  cancel?: AbortSignal,
): Promise<Spark> {
  const brand = request.brand.trim();
  if (!brand) {
    throw new ScanError("Enter a brand or category to scan.");
  }
  const scan = { brand, platform: request.platform };

  onPhase?.("research");
  const research = await runResearch(scan, cancel);
  if (cancel?.aborted) throw new ScanCanceled("Scan canceled.");
  onPhase?.("creative");

  // Request 2: the creative workflow. No retry.
  const result = await postJson(
    "/api/scan",
    { ...scan, researchToken: research.token, researchError: research.reason },
    SCAN_TIMEOUT_MS,
    cancel,
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
