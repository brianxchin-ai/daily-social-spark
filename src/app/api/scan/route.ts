import { EngineError, generateSparkDraft, MODEL } from "@/lib/engine/claude";
import { generateDemoSpark } from "@/lib/engine/demo";
import { PLATFORMS, type EngineMode, type HypothesisSpark, type Platform, type Spark } from "@/lib/types";

/**
 * /api/scan: the server-side doorway between the page and the engine.
 *
 * The engine is chosen explicitly with SPARK_ENGINE ("demo" by default).
 * In "claude" mode a failure is reported as an error; it never quietly
 * substitutes demo content.
 */

function engineMode(): EngineMode {
  return process.env.SPARK_ENGINE === "claude" ? "claude" : "demo";
}

/** GET: which engine is active, so the page can label itself honestly. */
export async function GET() {
  const engine = engineMode();
  return Response.json({ engine, model: engine === "claude" ? MODEL : null });
}

/** POST: run one scan and return a finished Spark. */
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
    const { draft, usage } = await generateSparkDraft(scan);
    const spark: HypothesisSpark = {
      id: `ai-${scan.platform}-${Date.now()}`,
      origin: "ai-hypothesis",
      generatedAt: new Date().toISOString(),
      brand: scan.brand,
      platform: scan.platform,
      ...draft,
      generation: {
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      },
    };
    return Response.json({ engine, spark });
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("Unexpected server error.", 500);
    return Response.json({ engine, error: safe.message }, { status: safe.status });
  }
}
