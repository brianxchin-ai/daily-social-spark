import { EngineError, generateSparkDraft } from "@/lib/engine/claude";
import { PLATFORMS, type Platform } from "@/lib/types";

/**
 * POST /api/scan: the server-side doorway between the page and Claude.
 *
 * The engine is chosen explicitly with SPARK_ENGINE ("demo" by default).
 * In "claude" mode a failure is reported as an error; it never quietly
 * substitutes demo content.
 */
export async function POST(request: Request) {
  const engine = process.env.SPARK_ENGINE === "claude" ? "claude" : "demo";

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

  if (engine === "demo") {
    return Response.json(
      { engine, error: "Demo engine is selected. Set SPARK_ENGINE=claude to use Claude." },
      { status: 409 },
    );
  }

  try {
    const { draft, usage } = await generateSparkDraft({ brand: brand.trim(), platform: platform as Platform });
    return Response.json({ engine, origin: "ai-hypothesis", draft, usage });
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("Unexpected server error.", 500);
    return Response.json({ engine, error: safe.message }, { status: safe.status });
  }
}
