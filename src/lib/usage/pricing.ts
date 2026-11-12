/**
 * What a Claude call costs, by the model that actually answered.
 *
 * With server-side fallback on, a request can be answered by a model other
 * than the one we asked for, so cost is priced from the model in the
 * response. A model we don't recognize is priced at a deliberately high rate
 * and flagged, so a surprise is overcounted rather than undercounted.
 */

/** USD per million tokens. Sonnet 5.5 confirmed from Anthropic's pricing docs on 2026-11-10. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Used for any model not in the table: well above any current list price, on purpose. */
export const UNKNOWN_MODEL_PRICE = { input: 15, output: 75 };

/** Anthropic's web search fee: $10 per 1,000 searches. */
export const SEARCH_PRICE_USD = 0.01;

/** Find the price for a model id, allowing dated snapshots ("claude-sonnet-5-5-20261001"). */
export function priceFor(model: string): { input: number; output: number; known: boolean } {
  const key = Object.keys(MODEL_PRICES).find((id) => model === id || model.startsWith(`${id}-`));
  return key ? { ...MODEL_PRICES[key], known: true } : { ...UNKNOWN_MODEL_PRICE, known: false };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, webSearches = 0): number {
  const price = priceFor(model);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000 + webSearches * SEARCH_PRICE_USD;
}
