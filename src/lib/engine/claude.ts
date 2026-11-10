import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { PLATFORMS, type ScanRequest } from "@/lib/types";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SparkDraftSchema, validateSparkDraft, type SparkDraft } from "@/lib/spark-schema";

/** Confirmed from Anthropic's live model and pricing docs on 2026-11-10. */
export const MODEL = "claude-sonnet-5-5";
const PRICE_PER_MTOK = { input: 2, output: 10 }; // USD; thinking tokens bill as output
const MAX_OUTPUT_TOKENS = 8_000; // per-call ceiling: worst case ≈ $0.08 of output

/** Our Zod schema, converted by Anthropic's helper into the JSON schema the API enforces. */
const SPARK_DRAFT_JSON_SCHEMA = betaZodOutputFormat(SparkDraftSchema).schema;

export interface ScanUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  requestId: string | null;
}

/** An error whose message is safe to show in the browser (never the raw SDK error). */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

const SYSTEM_PROMPT = `You are a senior social strategist. You identify ONE organic short-form social opportunity for a brand: a format, behaviour or cultural moment with momentum that the brand could credibly make content for.

You have NO live data, browsing, or platform analytics. Everything you produce is a hypothesis drawn from general knowledge, and it will be labelled as unverified. Therefore:
- Never invent URLs, publication or outlet names, creator handles, view counts, growth percentages, or any other statistic.
- Never predict hours, dates or deadlines. Describe timing only as a stage plus your reasoning, and say what observable signal would confirm it.
- Prefer formats that are gaining heat but not yet saturated, or proven formats still performing for other brands and creators.
- The opportunity must fit the platform's native conventions and be realistic for the brand to produce.
- The headline is a short display line, like a campaign line: 12 words or fewer, telling the brand what to make. Describe the full creative idea in the concept field; it is not limited to 12 words.
- Keep copy tight and specific. Write em dashes closed, with no spaces around them (Chicago style).`;

function userPrompt({ brand, platform }: ScanRequest): string {
  const platformLabel = PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
  return `Brand or category: ${brand}\nPlatform: ${platformLabel}\n\nPropose the single strongest short-form opportunity for this brand on this platform right now.`;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new EngineError(
      "Claude engine is selected but no API key is configured. Add ANTHROPIC_API_KEY to .env.local and restart the server.",
      500,
    );
  }
  // The SDK reads ANTHROPIC_API_KEY itself; the key never passes through our code.
  // maxRetries: 0 so a failed call is reported, never silently re-sent (and re-billed).
  client ??= new Anthropic({ maxRetries: 0 });
  return client;
}

/** Ask Claude for one Spark hypothesis, then validate it against our rulebook. */
export async function generateSparkDraft(
  request: ScanRequest,
): Promise<{ draft: SparkDraft; usage: ScanUsage }> {
  const anthropic = getClient();

  let response;
  let requestId: string | null = null;
  try {
    // create().withResponse() exposes Anthropic's request ID (useful for support tickets).
    // We avoid parse().withResponse(): in this SDK version it masks connection errors.
    const result = await anthropic.beta.messages
      .create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if the model declines on policy grounds, Anthropic retries on a suitable model
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(request) }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: SPARK_DRAFT_JSON_SCHEMA },
        },
      })
      .withResponse();
    response = result.data;
    requestId = result.request_id ?? null;
  } catch (error) {
    throw toEngineError(error);
  }

  const usage: ScanUsage = {
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd: estimateCost(response.usage.input_tokens, response.usage.output_tokens),
    requestId,
  };
  // Safe log: no key, headers, prompt or environment, only usage figures.
  console.info(
    `[claude] model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} est=$${usage.estimatedCostUsd.toFixed(4)} stop=${response.stop_reason} req=${usage.requestId}`,
  );

  if (response.stop_reason === "refusal") {
    throw new EngineError("Claude declined this request. Try a different brand or category.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new EngineError("Claude's answer was cut off before it finished. Please try again.", 502);
  }

  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError("Claude's answer wasn't valid JSON, so it wasn't shown.", 502);
  }

  const checked = validateSparkDraft(parsed);
  if (!checked.ok) {
    console.warn(`[claude] validation failed: ${checked.problems.join("; ")}`);
    throw new EngineError("Claude's answer didn't pass our format checks, so it wasn't shown.", 502);
  }

  return { draft: checked.draft, usage };
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
}

/** Translate SDK errors into plain, safe messages. Most specific first. */
function toEngineError(error: unknown): EngineError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new EngineError("The API key was rejected. Check ANTHROPIC_API_KEY in .env.local.", 500);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new EngineError("This API key doesn't have access to the selected model.", 500);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new EngineError(
      "Anthropic is limiting requests right now (rate limit or monthly spend cap). Try again later.",
      429,
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    // Includes a spend limit you set yourself in the Console.
    console.warn(`[claude] bad request (status 400, req=${error.requestID ?? "n/a"})`);
    return new EngineError(
      "Anthropic rejected the request. If you've set a monthly spend limit, it may have been reached.",
      400,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new EngineError("Couldn't reach Anthropic. Check your internet connection.", 503);
  }
  if (error instanceof Anthropic.APIError) {
    console.warn(`[claude] API error status=${error.status} req=${error.requestID ?? "n/a"}`);
    return new EngineError("Anthropic returned an error. Please try again shortly.", 502);
  }
  console.warn("[claude] unexpected error type");
  return new EngineError("Something went wrong while contacting Claude.", 500);
}
