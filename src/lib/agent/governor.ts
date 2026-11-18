import { costOfUsage, priceFor, SEARCH_PRICE_USD, type BilledUsage } from "../usage/pricing.ts";

/**
 * The line producer's petty-cash rules for one agent scan.
 *
 * The agent never holds the money. Before every paid call (an agent turn, a
 * search, a page read, an evaluation, a rescore), code asks the governor. The
 * governor prices that call's worst case and refuses it if it couldn't fit
 * under the ceiling alongside what's already spent and everything still in
 * flight. When a call ends, its hold is swapped for what it actually cost.
 *
 * This is the same idea as the beta's shared-budget holds (usage/policy.ts),
 * applied inside one scan. It's enforced against our own conservative
 * estimate of the bill, not against Anthropic's invoice, so the ceiling is as
 * hard as a pre-call estimate can make it (see the Day 6 plan).
 *
 * Pure bookkeeping: no I/O, and the clock is injected so tests can move time.
 */

export const AGENT_LIMITS = {
  /** Never start a call whose worst case would take the scan past this. */
  ceilingUsd: 0.75,
  /** From here on, research stops and the agent is told to finish (the ceiling minus the finishing reserve). */
  wrapUpUsd: 0.47,
  /**
   * Held back until the first review has run, so research can never leave a
   * scan unable to finish (Day 6, after a real run spent $0.63 and couldn't
   * afford its review). Searches, page reads and rescores can't touch it.
   */
  finishingReserveUsd: 0.28,
  /** The part of the finishing reserve only the review itself may use: agent turns can't touch it either. */
  reviewReserveUsd: 0.15,
  maxTurns: 24,
  wrapUpTurn: 18,
  maxToolCalls: 40,
  maxSearches: 8,
  maxReads: 3,
  /** Open shape: reviews of 1 to 3 ideas each. */
  maxEvaluations: 4,
  maxRescores: 2,
  /** Quick first reads on noted ideas (not scores). Cheap, and limited so they don't replace judgment. */
  maxGutChecks: 3,
  /** Output cap for one agent turn (thinking included); lowered when money is short. Raised from 8,000 with high effort. */
  maxTurnOutputTokens: 12_000,
  /** Below this, an agent turn isn't worth making: the run ends instead. */
  minTurnOutputTokens: 1_500,
  /** Past this context size, the agent is told to finish. */
  contextWrapTokens: 60_000,
  wallClockMs: 270_000,
  wrapUpMs: 200_000,
  /** A call needs at least this much time left to start. */
  minCallMs: 10_000,
  maxConsecutiveMalformed: 3,
  /** Added to every input estimate, because token counts are estimated before sending. */
  inputMargin: 0.15,
} as const;

export type AgentLimits = { [K in keyof typeof AGENT_LIMITS]: number };

export type PaidCallKind = "agent-turn" | "search" | "read" | "evaluate" | "rescore" | "gut-check";
export type Stage = "normal" | "wrap-up" | "stopped";
export type StopReason = "budget" | "time" | "turns" | "tool-calls" | "malformed" | "canceled" | "model-refused" | "model-error";
export type WrapUpReason = "budget" | "time" | "turns" | "context";

/** What code knows about a call before making it. */
export interface CallPlan {
  /** Estimated input tokens of what we're about to send (before the margin). */
  inputTokens: number;
  /** The call's output cap. For agent turns, the governor may lower it. */
  maxOutputTokens: number;
  /** Web searches the call may run (server tool `max_uses`). */
  maxSearches?: number;
  /** Extra input the server adds mid-call (search results, fetched page text), worst case. */
  serverAddedTokens?: number;
}

export type Authorization =
  | { ok: true; ticket: number; maxOutputTokens: number; holdUsd: number; timeLeftMs: number }
  | {
      ok: false;
      /** Plain-English reason, safe to show the agent and the trace. */
      reason: string;
      /** True when the whole run must end now (nothing useful can still fit). */
      ends: boolean;
    };

const MODEL = "claude-sonnet-5-5";

/** Conservative token estimate for text we're about to send: about 3 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export class Governor {
  readonly limits: AgentLimits;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly price = priceFor(MODEL);

  /** Measured cost of finished calls (uncertain ones counted at their full hold). */
  private settledUsd = 0;
  /** Worst-case holds of calls still in flight, by ticket. */
  private readonly holds = new Map<number, { kind: PaidCallKind; usd: number }>();
  private nextTicket = 1;

  private readonly counts: Record<PaidCallKind, number> = { "agent-turn": 0, search: 0, read: 0, evaluate: 0, rescore: 0, "gut-check": 0 };
  private toolCalls = 0;
  private consecutiveMalformed = 0;
  private lastContextTokens = 0;
  private stopReason: StopReason | null = null;
  private uncertainCalls = 0;
  private overrun = false;

  constructor(limits: Partial<AgentLimits> = {}, now: () => number = Date.now) {
    this.limits = { ...AGENT_LIMITS, ...limits };
    this.now = now;
    this.startedAt = now();
  }

  /* ---------- Readouts ---------- */

  /** Spent so far plus every hold in flight: what the ceiling is checked against. */
  committedUsd(): number {
    let held = 0;
    for (const h of this.holds.values()) held += h.usd;
    return this.settledUsd + held;
  }

  spentUsd(): number {
    return this.settledUsd;
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  timeLeftMs(): number {
    return this.limits.wallClockMs - this.elapsedMs();
  }

  count(kind: PaidCallKind): number {
    return this.counts[kind];
  }

  /** Why the run is in wrap-up, or null. */
  wrapUpReason(): WrapUpReason | null {
    if (this.committedUsd() >= this.limits.wrapUpUsd) return "budget";
    if (this.elapsedMs() >= this.limits.wrapUpMs) return "time";
    if (this.counts["agent-turn"] >= this.limits.wrapUpTurn) return "turns";
    if (this.lastContextTokens >= this.limits.contextWrapTokens) return "context";
    return null;
  }

  stage(): Stage {
    if (this.stopReason) return "stopped";
    if (this.timeLeftMs() < this.limits.minCallMs) return "stopped";
    return this.wrapUpReason() ? "wrap-up" : "normal";
  }

  /** Why the run stopped, or null if it hasn't. */
  stopped(): StopReason | null {
    if (this.stopReason) return this.stopReason;
    if (this.timeLeftMs() < this.limits.minCallMs) return "time";
    return null;
  }

  /** Facts for the agent's budget readout and the trace. */
  snapshot() {
    return {
      stage: this.stage(),
      wrapUpReason: this.wrapUpReason(),
      stopReason: this.stopped(),
      spentUsd: round4(this.settledUsd),
      committedUsd: round4(this.committedUsd()),
      ceilingUsd: this.limits.ceilingUsd,
      remainingUsd: round4(Math.max(0, this.limits.ceilingUsd - this.committedUsd())),
      /** Held back for the first review and finishing; released once a review has run. */
      reservedUsd: this.counts.evaluate > 0 ? 0 : this.limits.finishingReserveUsd,
      elapsedMs: this.elapsedMs(),
      timeLeftMs: Math.max(0, this.timeLeftMs()),
      turns: this.counts["agent-turn"],
      maxTurns: this.limits.maxTurns,
      toolCalls: this.toolCalls,
      maxToolCalls: this.limits.maxToolCalls,
      searches: this.counts.search,
      maxSearches: this.limits.maxSearches,
      reads: this.counts.read,
      maxReads: this.limits.maxReads,
      evaluations: this.counts.evaluate,
      maxEvaluations: this.limits.maxEvaluations,
      rescores: this.counts.rescore,
      maxRescores: this.limits.maxRescores,
      gutChecks: this.counts["gut-check"],
      maxGutChecks: this.limits.maxGutChecks,
      uncertainCalls: this.uncertainCalls,
      overrun: this.overrun,
    };
  }

  /* ---------- Pricing ---------- */

  /** Worst-case cost of a call: inputs at the cache-write rate plus a margin, the full output cap, every search. */
  worstCaseUsd(plan: CallPlan, maxOutputTokens = plan.maxOutputTokens): number {
    const inputPrice = Math.max(this.price.input, this.price.cacheWrite);
    const input = (plan.inputTokens * (1 + this.limits.inputMargin) + (plan.serverAddedTokens ?? 0)) * inputPrice;
    const output = maxOutputTokens * this.price.output;
    return (input + output) / 1_000_000 + (plan.maxSearches ?? 0) * SEARCH_PRICE_USD;
  }

  /* ---------- Permission to spend ---------- */

  /**
   * Ask before a paid call. On success the call's worst case is held until
   * `settle`. An agent turn's output cap is lowered to fit the money left; if
   * even the minimum can't fit, the run ends.
   */
  authorize(kind: PaidCallKind, plan: CallPlan): Authorization {
    const stop = this.stopped();
    if (stop) return { ok: false, reason: STOP_TEXT[stop], ends: true };

    const L = this.limits;
    const isTurn = kind === "agent-turn";
    const wrap = this.wrapUpReason();

    // Hard count limits.
    if (isTurn && this.counts["agent-turn"] >= L.maxTurns) return this.end("turns");
    const capped = countLimit(kind, this.counts, L);
    if (capped) return { ok: false, reason: capped, ends: false };
    // Research closes at wrap-up: the remaining money is kept for finishing.
    if ((kind === "search" || kind === "read") && wrap) {
      return { ok: false, reason: `Research is closed: the scan is wrapping up (${WRAP_TEXT[wrap]}). Finish with the ideas you have.`, ends: false };
    }

    // Until the first review has run, part of the budget is held for it (and for the turns around it).
    const reserved = this.counts.evaluate > 0 || kind === "evaluate" ? 0 : isTurn ? L.reviewReserveUsd : L.finishingReserveUsd;
    const room = L.ceilingUsd - this.committedUsd() - reserved;
    let maxOutputTokens = plan.maxOutputTokens;
    if (isTurn) {
      // Fit the output cap to the money left, never above the per-turn cap.
      const inputOnly = this.worstCaseUsd(plan, 0);
      const affordable = Math.floor(((room - inputOnly) * 1_000_000) / this.price.output);
      maxOutputTokens = Math.min(plan.maxOutputTokens, L.maxTurnOutputTokens, affordable);
      if (maxOutputTokens < L.minTurnOutputTokens) return this.end("budget");
    }

    const holdUsd = this.worstCaseUsd(plan, maxOutputTokens);
    if (holdUsd > room + 1e-9) {
      return {
        ok: false,
        reason: `Not enough budget left for this ${KIND_TEXT[kind]} (worst case $${holdUsd.toFixed(3)}, $${Math.max(0, room).toFixed(3)} available${
          reserved ? `; $${reserved.toFixed(2)} is held for reviewing and finishing` : ""
        }).`,
        ends: false,
      };
    }

    const ticket = this.nextTicket++;
    this.holds.set(ticket, { kind, usd: holdUsd });
    this.counts[kind] += 1;
    return { ok: true, ticket, maxOutputTokens, holdUsd, timeLeftMs: this.timeLeftMs() - 2_000 };
  }

  /**
   * Swap a hold for what the call cost. `usage` null means the call ended
   * without a readable bill (timeout, cancel, dropped connection): it may
   * still have been billed, so its full worst case is kept.
   * Returns the cost recorded for this call.
   */
  settle(ticket: number, outcome: { model: string; usage: BilledUsage } | null): number {
    const hold = this.holds.get(ticket);
    if (!hold) return 0;
    this.holds.delete(ticket);
    let usd: number;
    if (outcome) {
      usd = costOfUsage(outcome.model, outcome.usage);
      if (hold.kind === "agent-turn") {
        this.lastContextTokens =
          outcome.usage.inputTokens + (outcome.usage.cacheReadTokens ?? 0) + (outcome.usage.cacheWriteTokens ?? 0);
      }
    } else {
      usd = hold.usd;
      this.uncertainCalls += 1;
    }
    this.settledUsd += usd;
    // An estimate that came in low (or a model priced higher than expected) can
    // only end the run, never permit more spending.
    if (this.settledUsd > this.limits.ceilingUsd + 1e-9) {
      this.overrun = true;
      this.stopReason ??= "budget";
    }
    return usd;
  }

  /** Release a hold for a call that was never sent (e.g., failed validation first). */
  release(ticket: number): void {
    const hold = this.holds.get(ticket);
    if (!hold) return;
    this.holds.delete(ticket);
    this.counts[hold.kind] = Math.max(0, this.counts[hold.kind] - 1);
  }

  /* ---------- Free actions and run health ---------- */

  /** Count any tool call the agent makes, paid or free. Returns a refusal once the limit is reached. */
  countToolCall(): { ok: true } | { ok: false; reason: string; ends: boolean } {
    if (this.toolCalls >= this.limits.maxToolCalls) {
      this.stopReason ??= "tool-calls";
      return { ok: false, reason: STOP_TEXT["tool-calls"], ends: true };
    }
    this.toolCalls += 1;
    return { ok: true };
  }

  /** Track badly formed tool input; too many in a row ends the run. Returns true if the run should end. */
  recordToolInput(wellFormed: boolean): boolean {
    this.consecutiveMalformed = wellFormed ? 0 : this.consecutiveMalformed + 1;
    if (this.consecutiveMalformed >= this.limits.maxConsecutiveMalformed) {
      this.stopReason ??= "malformed";
      return true;
    }
    return false;
  }

  /** End the run for a reason found outside the governor (cancel, refusal). */
  halt(reason: StopReason): void {
    this.stopReason ??= reason;
  }

  private end(reason: StopReason): Authorization {
    this.stopReason ??= reason;
    return { ok: false, reason: STOP_TEXT[reason], ends: true };
  }
}

function countLimit(kind: PaidCallKind, counts: Record<PaidCallKind, number>, L: AgentLimits): string | null {
  if (kind === "search" && counts.search >= L.maxSearches) return `Search limit reached (${L.maxSearches} per scan).`;
  if (kind === "read" && counts.read >= L.maxReads) return `Page-reading limit reached (${L.maxReads} per scan).`;
  if (kind === "evaluate" && counts.evaluate >= L.maxEvaluations) return `Evaluation limit reached (${L.maxEvaluations} rounds per scan).`;
  if (kind === "rescore" && counts.rescore >= L.maxRescores) return `Revision limit reached (${L.maxRescores} per scan).`;
  if (kind === "gut-check" && counts["gut-check"] >= L.maxGutChecks) return `Gut-check limit reached (${L.maxGutChecks} per scan).`;
  return null;
}

const KIND_TEXT: Record<PaidCallKind, string> = {
  "agent-turn": "agent turn",
  search: "search",
  read: "page read",
  evaluate: "evaluation",
  rescore: "rescore",
  "gut-check": "gut-check",
};

const WRAP_TEXT: Record<WrapUpReason, string> = {
  budget: "most of the budget is used",
  time: "time is running short",
  turns: "most turns are used",
  context: "the working notes are getting long",
};

export const STOP_TEXT: Record<StopReason, string> = {
  budget: "Budget limit reached: no further AI calls fit under the per-scan ceiling.",
  time: "Time limit reached: not enough time left for another call.",
  turns: "Turn limit reached.",
  "tool-calls": "Tool-call limit reached.",
  malformed: "Stopped after repeated badly formed tool calls.",
  canceled: "Scan canceled.",
  "model-refused": "The model declined to continue.",
  "model-error": "An AI call failed, and failed calls are never retried.",
};

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
