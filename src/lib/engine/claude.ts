import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { CandidateSetSchema, validateCandidateSet, type CandidateDraft } from "@/lib/spark-schema";
import { PLATFORMS, type ScanRequest } from "@/lib/types";

/** Confirmed from Anthropic's live model and pricing docs on 2026-11-10. */
export const MODEL = "claude-sonnet-5-5";
const PRICE_PER_MTOK = { input: 2, output: 10 }; // USD; thinking tokens bill as output

export interface ScanUsage {
  /** Which step made the call, e.g. "generator" or "evaluator". */
  step: string;
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

/**
 * One structured call to Claude: send a prompt, require JSON in `schema`'s shape,
 * then run our own rulebook (`validate`) before anything is used.
 * Shared by the generator and the evaluator.
 */
export async function callStructured<T>(options: {
  step: string;
  system: string;
  user: string;
  schema: ZodType;
  maxTokens: number;
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; problems: string[] };
}): Promise<{ value: T; usage: ScanUsage }> {
  const anthropic = getClient();
  const { step } = options;
  // Our Zod schema, converted by Anthropic's helper into the JSON schema the API enforces.
  const jsonSchema = betaZodOutputFormat(options.schema).schema;

  let response;
  let requestId: string | null = null;
  try {
    // create().withResponse() exposes Anthropic's request ID (useful for support tickets).
    // We avoid parse().withResponse(): in this SDK version it masks connection errors.
    const result = await anthropic.beta.messages
      .create({
        model: MODEL,
        max_tokens: options.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if the model declines on policy grounds, Anthropic retries on a suitable model
        system: options.system,
        messages: [{ role: "user", content: options.user }],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: jsonSchema },
        },
      })
      .withResponse();
    response = result.data;
    requestId = result.request_id ?? null;
  } catch (error) {
    throw toEngineError(error, step);
  }

  const usage: ScanUsage = {
    step,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd: estimateCost(response.usage.input_tokens, response.usage.output_tokens),
    requestId,
  };
  // Safe log: no key, headers, prompt or environment, only usage figures.
  console.info(
    `[claude:${step}] model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} est=$${usage.estimatedCostUsd.toFixed(4)} stop=${response.stop_reason} req=${usage.requestId}`,
  );

  if (response.stop_reason === "refusal") {
    throw new EngineError(`Claude declined the ${step} step. Try a different brand or category.`, 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new EngineError(`Claude's ${step} answer was cut off before it finished. Please try again.`, 502);
  }

  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError(`Claude's ${step} answer wasn't valid JSON, so nothing was shown.`, 502);
  }

  const checked = options.validate(parsed);
  if (!checked.ok) {
    console.warn(`[claude:${step}] validation failed: ${checked.problems.join("; ")}`);
    throw new EngineError(`Claude's ${step} answer didn't pass our format checks, so nothing was shown.`, 502);
  }
  return { value: checked.value, usage };
}

/* ---------- Generator ---------- */

const GENERATOR_SYSTEM = `You are a senior social strategist. You propose organic short-form social opportunities for a brand: formats, behaviors or cultural moments with momentum that the brand could credibly make content for.

You have NO live data, browsing, or platform analytics. Everything you produce is a hypothesis drawn from general knowledge, and it will be labeled as unverified. Therefore:
- Never invent URLs, publication or outlet names, creator handles, view counts, growth percentages, or any other statistic.
- Never predict hours, dates or deadlines. Describe timing only as a stage plus your reasoning, and say what observable signal would confirm it.
- Prefer formats that are gaining heat but not yet saturated, or proven formats still performing for other brands and creators.
- Each opportunity must fit the platform's native conventions and be realistic for the brand to produce.
- Do not rate, score or rank your own ideas. A separate reviewer evaluates them.

Write exactly three candidates, and make them genuinely different: each built on a distinct creative mechanic, not three versions of one idea.

Audio: treat dependence on one specific track as a weakness. If an idea is audio-led, give at least three alternative executions that keep the mechanic recognizable and compelling without copying the original sound (original voiceover, silence, visual-only, different audio).

Copy: the headline is a short display line, like a campaign line: 12 words or fewer, telling the brand what to make. Describe the full creative idea in the concept field; it is not limited to 12 words. Keep copy tight and specific. Use American English spelling (e.g. "behavior", "recognize", "favor"). Write em dashes closed, with no spaces around them (Chicago style).`;

export function platformLabel(platform: ScanRequest["platform"]): string {
  return PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
}

/** Generator call: three distinct candidates, validated, never self-scored. */
export async function generateCandidates(
  request: ScanRequest,
): Promise<{ candidates: CandidateDraft[]; usage: ScanUsage }> {
  const { value, usage } = await callStructured({
    step: "generator",
    system: GENERATOR_SYSTEM,
    user: `Brand or category: ${request.brand}\nPlatform: ${platformLabel(request.platform)}\n\nPropose three distinct short-form opportunities for this brand on this platform right now.`,
    schema: CandidateSetSchema,
    maxTokens: 12_000, // worst case ≈ $0.12 of output
    validate: validateCandidateSet,
  });
  return { candidates: value.candidates, usage };
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1_000_000;
}

/** Translate SDK errors into plain, safe messages. Most specific first. */
function toEngineError(error: unknown, step: string): EngineError {
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
    console.warn(`[claude:${step}] bad request (status 400, req=${error.requestID ?? "n/a"})`);
    return new EngineError(
      "Anthropic rejected the request. If you've set a monthly spend limit, it may have been reached.",
      400,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new EngineError("Couldn't reach Anthropic. Check your internet connection.", 503);
  }
  if (error instanceof Anthropic.APIError) {
    console.warn(`[claude:${step}] API error status=${error.status} req=${error.requestID ?? "n/a"}`);
    return new EngineError("Anthropic returned an error. Please try again shortly.", 502);
  }
  console.warn(`[claude:${step}] unexpected error type`);
  return new EngineError("Something went wrong while contacting Claude.", 500);
}
