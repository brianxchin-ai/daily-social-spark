import type { EngineMode, ScanRequest, Spark } from "@/lib/types";

/**
 * The page's side of a scan. It never generates content itself: it asks our
 * own /api/scan route, which runs whichever engine SPARK_ENGINE selects.
 * If that fails, the error is shown. Nothing is substituted.
 */

/** Progress steps shown while waiting, per engine. */
export const SCAN_STEPS: Record<EngineMode, readonly string[]> = {
  demo: ["Reading platform signals", "Checking sources", "Scoring momentum", "Drafting recommendations"],
  claude: ["Generating three candidates", "Checking the format rules", "Evaluating with a separate reviewer", "Ranking by Concept Score"],
};

/** Roughly how long each engine takes, used only to pace the progress bar. */
export const EXPECTED_SCAN_MS: Record<EngineMode, number> = { demo: 3200, claude: 50_000 };

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

export async function runScan(request: ScanRequest): Promise<Spark> {
  const brand = request.brand.trim();
  if (!brand) {
    throw new ScanError("Enter a brand or category to scan.");
  }

  let response: Response;
  try {
    response = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand, platform: request.platform }),
    });
  } catch {
    throw new ScanError("Couldn't reach the app's server. Is it still running?");
  }

  const payload = (await response.json().catch(() => null)) as { spark?: Spark; error?: string } | null;
  if (!response.ok || !payload?.spark) {
    throw new ScanError(payload?.error ?? `The scan failed (HTTP ${response.status}).`);
  }
  const { spark } = payload;
  if (spark.origin !== "demo" && spark.origin !== "ai-hypothesis") {
    throw new ScanError("The server returned a result in an unexpected format.");
  }
  return spark;
}
