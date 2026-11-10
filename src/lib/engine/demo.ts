import "server-only";

import { DEMO_TEMPLATES } from "@/data/demo-sparks";
import type { DemoSpark, ScanRequest } from "@/lib/types";

/** Pause that mimics research so the demo flow feels like a scan. */
export const DEMO_SCAN_MS = 3200;

/** The demo engine: placeholder content, used only when SPARK_ENGINE=demo. */
export async function generateDemoSpark(request: ScanRequest): Promise<DemoSpark> {
  await new Promise((resolve) => setTimeout(resolve, DEMO_SCAN_MS));
  return {
    id: `demo-${request.platform}-${Date.now()}`,
    origin: "demo",
    generatedAt: new Date().toISOString(),
    brand: request.brand,
    platform: request.platform,
    ...DEMO_TEMPLATES[request.platform](request.brand),
  };
}
