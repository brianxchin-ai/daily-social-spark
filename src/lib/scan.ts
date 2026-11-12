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

/** A public-beta usage limit stopped the scan before any paid call. Not a failure of the scan itself. */
export class ScanLimited extends ScanError {}

/** Thrown when the person cancels a scan. Not an error to show: the page simply resets. */
export class ScanCanceled extends Error {}

/** The visitor's public-beta allowance, as reported by the server. */
export interface BetaLimits {
  enforced: boolean;
  /** False when usage tracking can't be reached: live scans are paused. */
  available?: boolean;
  remaining?: number;
  limit?: number;
  resetsAt?: string;
  budgetAvailable?: boolean;
  budgetResetsAt?: string;
  active?: boolean;
}

export interface EngineStatus {
  engine: EngineMode;
  model: string | null;
  /** Whether live research runs before the creative request. */
  research: "live" | "off";
  limits?: BetaLimits;
}

/** "4:00 PM PST" in the visitor's own time zone. */
export function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** "Dec 1" in the visitor's own time zone. */
export function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Turn a usage-limit refusal from the server into a plain message with the
 * reset time in the visitor's own time zone. Null if it isn't one.
 */
export function limitMessage(payload: Record<string, unknown> | null): string | null {
  const limit = payload?.limit as { kind?: string; resetsAt?: string; limit?: number } | undefined;
  if (!limit?.kind) return null;
  const base = typeof payload?.error === "string" ? payload.error : "This scan isn't available right now.";
  const at = limit.resetsAt;
  switch (limit.kind) {
    case "daily":
      return `${base} Your allowance resets at ${at ? localTime(at) : "midnight UTC"}. Nothing was charged for this attempt.`;
    case "network":
      return `${base} It resets at ${at ? localTime(at) : "midnight UTC"}.`;
    case "budget":
      return `${base} They resume ${at ? `on ${localDate(at)}` : "next cycle"}. Thanks for testing!`;
    default:
      return base;
  }
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
): Promise<{ token: string | null; reason: string | null; attemptId: string | null }> {
  const status = await fetch("/api/research", { cache: "no-store", signal: cancel })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (cancel?.aborted) throw new ScanCanceled("Scan canceled.");
  if (status?.research !== "live") return { token: null, reason: null, attemptId: null };

  const result = await postJson("/api/research", request, RESEARCH_TIMEOUT_MS, cancel);
  // A usage limit stops the scan here: no creative request is sent.
  const limited = limitMessage(result.payload);
  if (limited) throw new ScanLimited(limited);
  // The attempt this research belongs to: the creative request continues it.
  const attemptId = typeof result.payload?.attemptId === "string" ? result.payload.attemptId : null;
  const token = typeof result.payload?.token === "string" ? result.payload.token : null;
  if (result.ok && token) return { token, reason: null, attemptId };
  const error = typeof result.payload?.error === "string" ? result.payload.error : null;
  return {
    attemptId,
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
    { ...scan, researchToken: research.token, researchError: research.reason, attemptId: research.attemptId },
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
  const limited = limitMessage(result.payload);
  if (limited) throw new ScanLimited(limited);
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
