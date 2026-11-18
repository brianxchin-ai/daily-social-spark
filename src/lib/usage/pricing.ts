/**
 * What a Claude call costs, by the model that actually answered.
 *
 * With server-side fallback on, a request can be answered by a model other
 * than the one we asked for, so cost is priced from the model in the
 * response. A model we don't recognize is priced at a deliberately high rate
 * and flagged, so a surprise is overcounted rather than undercounted.
 */

export interface ModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens (thinking included). */
  output: number;
  /** USD per million tokens written to the 5-minute prompt cache. */
  cacheWrite: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
}

/**
 * USD per million tokens. Sonnet 5.5 confirmed from Anthropic's pricing docs on
 * 2026-11-10; cache prices confirmed 2026-11-18 (5-minute write $2.50, hit $0.10,
 * which is 0.05x input for Sonnet 5.5).
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
};

/** Used for any model not in the table: well above any current list price, on purpose. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 15 };

/** Anthropic's web search fee: $10 per 1,000 searches. */
export const SEARCH_PRICE_USD = 0.01;

/** Find the price for a model id, allowing dated snapshots ("claude-sonnet-5-5-20261001"). */
export function priceFor(model: string): ModelPrice & { known: boolean } {
  const key = Object.keys(MODEL_PRICES).find((id) => model === id || model.startsWith(`${id}-`));
  return key ? { ...MODEL_PRICES[key], known: true } : { ...UNKNOWN_MODEL_PRICE, known: false };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, webSearches = 0): number {
  const price = priceFor(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000 + webSearches * SEARCH_PRICE_USD;
}

/** Billed usage of one response, as the API reports it. Cached tokens are counted separately from `inputTokens`. */
export interface BilledUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  webSearches?: number;
}

/** Cost of one response, including prompt-cache writes and reads. */
export function costOfUsage(model: string, usage: BilledUsage): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite +
      (usage.cacheReadTokens ?? 0) * price.cacheRead) /
      1_000_000 +
    (usage.webSearches ?? 0) * SEARCH_PRICE_USD
  );
}
