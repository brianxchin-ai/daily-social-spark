import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";
import { CandidateSetSchema, validateCandidateSet, type CandidateDraft } from "@/lib/spark-schema";
import { generatorSystem, ledgerDigest } from "@/lib/prompts/creative";
import type { EvidenceLedger } from "@/lib/research/ledger";
import { PLATFORMS, type ScanRequest } from "@/lib/types";
import { recordCost, recordUncertain } from "@/lib/usage/meter";
import { estimateCostUsd, priceFor } from "@/lib/usage/pricing";

/** Confirmed from Anthropic's live model and pricing docs on 2026-11-10. */
export const MODEL = "claude-sonnet-5-5";
// Prices live in usage/pricing.ts and follow the model that actually answered.

export interface ScanUsage {
  /** Which step made the call, e.g. "generator" or "evaluator". */
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  requestId: string | null;
  /** Web searches billed in this call (Scout only). */
  webSearches?: number;
}

/** An error whose message is safe to show in the browser (never the raw SDK error). */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Set when Claude answered (and billed) before the step failed, so costs stay accurate. */
    readonly usage?: ScanUsage,
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
  /** Server-side limit for this call, in milliseconds. No retry after a timeout. */
  timeoutMs: number;
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; problems: string[] };
  /** Fires when the person cancels the scan: the call in progress is stopped. */
  signal?: AbortSignal;
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
      }, { timeout: options.timeoutMs, signal: options.signal })
      .withResponse();
    response = result.data;
    requestId = result.request_id ?? null;
  } catch (error) {
    if (mayHaveBilled(error)) recordUncertain();
    throw toEngineError(error, step);
  }

  const usage: ScanUsage = {
    step,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd: estimateCostUsd(response.model, response.usage.input_tokens, response.usage.output_tokens),
    requestId,
  };
  // Count it toward usage limits now, before any later check can fail.
  recordCost(usage.estimatedCostUsd, response.model, priceFor(response.model).known);
  // Safe log: no key, headers, prompt or environment, only usage figures.
  console.info(
    `[claude:${step}] model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} est=$${usage.estimatedCostUsd.toFixed(4)} stop=${response.stop_reason} req=${usage.requestId}`,
  );

  if (response.stop_reason === "refusal") {
    throw new EngineError(`Claude declined the ${step} step. Try a different brand or category.`, 422, usage);
  }
  if (response.stop_reason === "max_tokens") {
    throw new EngineError(`Claude's ${step} answer was cut off before it finished. Please try again.`, 502, usage);
  }

  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EngineError(`Claude's ${step} answer wasn't valid JSON, so nothing was shown.`, 502, usage);
  }

  const checked = options.validate(parsed);
  if (!checked.ok) {
    console.warn(`[claude:${step}] validation failed: ${checked.problems.join("; ")}`);
    throw new EngineError(`Claude's ${step} answer didn't pass our format checks, so nothing was shown.`, 502, usage);
  }
  return { value: checked.value, usage };
}

/* ---------- Web search call (Scout step 1) ---------- */


/**
 * One call with Anthropic's web search tool. No structured output here: the
 * API attaches live citations to the text, and citations can't be combined
 * with enforced JSON. Returns every content block so our code can build the
 * source register from what the API actually retrieved.
 *
 * Limits: `maxSearches` across the whole call, one automatic resume if the
 * API pauses a long search turn (an API mechanic, not a retry), and a single
 * deadline for both parts. No retries.
 */
export async function callWithSearch(options: {
  step: string;
  system: string;
  user: string;
  maxTokens: number;
  maxSearches: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ content: Anthropic.Beta.Messages.BetaContentBlock[]; usage: ScanUsage }> {
  const anthropic = getClient();
  const { step } = options;
  const deadline = Date.now() + options.timeoutMs;
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: options.user }];
  const content: Anthropic.Beta.Messages.BetaContentBlock[] = [];
  const usage: ScanUsage = { step, model: MODEL, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requestId: null, webSearches: 0 };
  let stopReason: string | null = null;

  for (let part = 0; part < 2; part++) {
    const remainingSearches = options.maxSearches - (usage.webSearches ?? 0);
    const remainingMs = deadline - Date.now();
    if (part > 0 && (remainingSearches <= 0 || remainingMs < 5_000)) break;
    if (options.signal?.aborted) throw canceledError(step);

    let response;
    try {
      const result = await anthropic.beta.messages
        .create({
          model: MODEL,
          max_tokens: options.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: options.system,
          messages,
          tools: [
            {
              type: "web_search_20260209",
              name: "web_search",
              max_uses: remainingSearches,
              // Direct calls (no dynamic-filtering code step), so every result
              // reaches us as a web_search_tool_result block we can register.
              allowed_callers: ["direct"],
            },
          ],
          output_config: { effort: "medium" },
        }, { timeout: remainingMs, signal: options.signal })
        .withResponse();
      response = result.data;
      usage.requestId ??= result.request_id ?? null;
    } catch (error) {
      if (mayHaveBilled(error)) recordUncertain();
      // If an earlier part already billed, keep its cost on the error.
      const safe = toEngineError(error, step);
      throw usage.inputTokens + usage.outputTokens > 0 ? new EngineError(safe.message, safe.status, usage) : safe;
    }

    const partSearches = response.usage.server_tool_use?.web_search_requests ?? 0;
    const partCost = estimateCostUsd(response.model, response.usage.input_tokens, response.usage.output_tokens, partSearches);
    recordCost(partCost, response.model, priceFor(response.model).known);
    usage.model = response.model;
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.webSearches = (usage.webSearches ?? 0) + partSearches;
    usage.estimatedCostUsd += partCost;
    content.push(...response.content);
    stopReason = response.stop_reason;

    console.info(
      `[claude:${step}] part=${part + 1} model=${response.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} searches=${response.usage.server_tool_use?.web_search_requests ?? 0} stop=${response.stop_reason} req=${usage.requestId}`,
    );

    if (response.stop_reason !== "pause_turn") break;
    // Resume: send the paused turn back unchanged; the server continues it.
    messages.splice(1, messages.length - 1, {
      role: "assistant",
      content: content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[],
    });
  }

  if (stopReason === "refusal") {
    throw new EngineError(`Claude declined the ${step} step. Try a different brand or category.`, 422, usage);
  }
  if (stopReason === "max_tokens") {
    throw new EngineError(`Claude's ${step} notes were cut off before they finished.`, 502, usage);
  }
  if (stopReason === "pause_turn") {
    throw new EngineError(`The ${step} step didn't finish within its search and time limits.`, 504, usage);
  }
  return { content, usage };
}

/* ---------- Generator ---------- */

export function platformLabel(platform: ScanRequest["platform"]): string {
  return PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
}

/**
 * Generator call: three distinct candidates, validated, never self-scored.
 * With a verified ledger, ideas are built from its signals; without one, they
 * are Day 2-style hypotheses from general knowledge.
 */
export async function generateCandidates(
  request: ScanRequest,
  ledger: EvidenceLedger | null,
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<{ candidates: CandidateDraft[]; usage: ScanUsage }> {
  const { value, usage } = await callStructured({
    step: "generator",
    system: generatorSystem(request.platform, ledger !== null),
    user: `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

${ledger ? ledgerDigest(ledger) : "No evidence ledger for this scan."}

Propose three distinct short-form opportunities for this brand on this platform.`,
    schema: CandidateSetSchema,
    maxTokens: 14_000, // worst case ≈ $0.14 of output
    timeoutMs,
    validate: validateCandidateSet,
    signal,
  });
  return { candidates: value.candidates, usage };
}

/**
 * Could this failed call still have been billed? An error response from the
 * API isn't billed, but a call cut off mid-flight (canceled, timed out, or
 * disconnected) may have been, so the usage tally treats it as uncertain.
 */
function mayHaveBilled(error: unknown): boolean {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionError) return true;
  return !(error instanceof Anthropic.APIError);
}

/** Translate SDK errors into plain, safe messages. Most specific first. */
/** The person canceled the scan. Status 499: the client closed the request. */
export function canceledError(step: string): EngineError {
  console.info(`[claude:${step}] canceled by the user; no further calls`);
  return new EngineError("The scan was canceled.", 499);
}

function toEngineError(error: unknown, step: string): EngineError {
  if (error instanceof Anthropic.APIUserAbortError) return canceledError(step);
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
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    console.warn(`[claude:${step}] timed out`);
    return new EngineError(`Claude took too long on the ${step} step, so it was stopped (no retry).`, 504);
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
