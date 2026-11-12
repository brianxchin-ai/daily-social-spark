import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A running tab of what one request has spent on Claude.
 *
 * Every Claude call reports its billed usage here as soon as the response
 * arrives, so the tab is right even if a later step fails or the person
 * cancels. A call that ends without a response we can read (a timeout, a
 * cancel mid-call, a dropped connection) may still have been billed, so the
 * tab is marked "uncertain" and the request is charged its full hold.
 *
 * AsyncLocalStorage gives each request its own tab, even when several
 * requests run in the same server process at once.
 */

export interface Meter {
  knownUsd: number;
  uncertain: boolean;
  unknownModels: string[];
}

const storage = new AsyncLocalStorage<Meter>();

export function newMeter(): Meter {
  return { knownUsd: 0, uncertain: false, unknownModels: [] };
}

/** Run `fn` with `meter` as the tab for every Claude call it makes. */
export function withMeter<T>(meter: Meter, fn: () => Promise<T>): Promise<T> {
  return storage.run(meter, fn);
}

/** Record a billed response. */
export function recordCost(usd: number, model: string, modelKnown: boolean): void {
  const meter = storage.getStore();
  if (!meter) return;
  meter.knownUsd += Math.max(0, usd);
  if (!modelKnown && !meter.unknownModels.includes(model)) meter.unknownModels.push(model);
}

/** A call ended without a readable response: it may have been billed. */
export function recordUncertain(): void {
  const meter = storage.getStore();
  if (meter) meter.uncertain = true;
}

/** What to charge: the measured cost, or the full hold if anything is uncertain. */
export function chargeFor(meter: Meter, reserveUsd: number): number {
  return meter.uncertain ? Math.max(meter.knownUsd, reserveUsd) : meter.knownUsd;
}
