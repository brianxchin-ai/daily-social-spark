import { DEMO_TEMPLATES } from "@/data/demo-sparks";
import type { ScanRequest, Spark } from "@/lib/types";

/**
 * The scan "engine".
 * Today it is simulated: it pauses to mimic research, then returns demo
 * content. Later, only the inside of runScan changes (to call live
 * research and models); everything that uses it stays the same.
 */

/** Steps shown during the simulated loading state. */
export const SCAN_STEPS = [
  "Reading platform signals",
  "Checking sources",
  "Scoring momentum",
  "Drafting recommendations",
] as const;

export const SIMULATED_SCAN_MS = 3200;

export class ScanError extends Error {}

export async function runScan(request: ScanRequest): Promise<Spark> {
  const brand = request.brand.trim();
  if (!brand) {
    throw new ScanError("Enter a brand or category to scan.");
  }

  await new Promise((resolve) => setTimeout(resolve, SIMULATED_SCAN_MS));

  const template = DEMO_TEMPLATES[request.platform];
  return {
    id: `demo-${request.platform}-${Date.now()}`,
    isDemo: true,
    generatedAt: new Date().toISOString(),
    brand,
    platform: request.platform,
    ...template(brand),
  };
}
