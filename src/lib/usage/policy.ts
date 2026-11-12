/**
 * Public-beta usage rules: pure bookkeeping, no I/O.
 *
 * Think of it as a production budget with a petty-cash float:
 * - Every scan is an "attempt" (research + creative). Starting one uses one of
 *   the visitor's daily attempts, whether it later succeeds, fails or is canceled.
 * - Before any paid call, the attempt puts a worst-case amount "on hold"
 *   against the shared budget. Concurrent scans can't overspend, because each
 *   one has to fit alongside everyone else's holds.
 * - When a phase ends, the hold is swapped for the measured cost.
 * - A hold that's never settled (a crashed or killed request) expires and is
 *   charged in full, because we can't know what it spent.
 *
 * All functions take the state, change it, and return a decision. The store
 * runs them one at a time (see store.ts), which is what makes them safe
 * under concurrency.
 */

export interface UsageConfig {
  /** Paid scan attempts per browser per day. */
  dailyAttempts: number;
  /** Attempts per network (IP address) per day: a backstop against clearing cookies. */
  networkDailyAttempts: number;
  /** Shared public-beta budget per credit cycle, USD. */
  budgetUsd: number;
  /** Day of the month (1–28) when the budget cycle resets, at 00:00 UTC. */
  cycleResetDay: number;
}

/** Worst-case cost of each phase: held before the phase starts. */
export const RESERVE_USD = {
  /** Up to 6 searches, a possible resumed search turn, and the filing call. Typical: about $0.20. */
  research: 0.8,
  /** Generator, evaluator, editor and rescore at their token caps. Typical: about $0.15–0.20. */
  creative: 0.6,
} as const;

/** How long a phase may run before its hold is treated as abandoned (beyond the 300s request limit). */
export const PHASE_TTL_MS = 6 * 60_000;
/** After research, how long the creative request has to start. */
export const HANDOFF_TTL_MS = 3 * 60_000;

type Phase = "research" | "creative";

export interface Attempt {
  id: string;
  visitor: string;
  network: string;
  createdAt: number;
  /** research → between → creative → done */
  stage: "research" | "between" | "creative" | "done";
  /** The phase running now and its hold, if any. */
  inflight: { phase: Phase; reserveUsd: number; expiresAt: number } | null;
  /** Held for the creative phase while research runs and until creative starts. */
  heldUsd: number;
  holdExpiresAt: number;
  chargedUsd: number;
  /** Set if a phase was abandoned and charged its full hold. */
  abandonedChargeUsd?: number;
}

export interface UsageState {
  v: 1;
  /** Current budget cycle: its start date (UTC) and public spend so far. */
  cycle: { key: string; spentUsd: number; attempts: number };
  /** Totals for earlier cycles, newest first. */
  history: { key: string; spentUsd: number; attempts: number }[];
  /** Current UTC day and attempt counts per visitor and per network. */
  day: string;
  visitors: Record<string, number>;
  networks: Record<string, number>;
  attempts: Record<string, Attempt>;
}

export type Refusal =
  | { ok: false; kind: "busy"; message: string }
  | { ok: false; kind: "budget"; message: string; resetsAt: string }
  | { ok: false; kind: "daily"; message: string; resetsAt: string; limit: number }
  | { ok: false; kind: "network"; message: string; resetsAt: string }
  | { ok: false; kind: "handoff"; message: string };

export function emptyState(now: number, config: UsageConfig): UsageState {
  return {
    v: 1,
    cycle: { key: cycleStart(now, config.cycleResetDay), spentUsd: 0, attempts: 0 },
    history: [],
    day: dayKey(now),
    visitors: {},
    networks: {},
    attempts: {},
  };
}

/* ---------- Time windows ---------- */

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Next 00:00 UTC: when daily allowances reset. */
export function nextDailyReset(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

const clampDay = (day: number) => Math.min(28, Math.max(1, Math.floor(day) || 1));

/** The start date (UTC) of the budget cycle containing `now`. */
export function cycleStart(now: number, resetDay: number): string {
  const d = new Date(now);
  const day = clampDay(resetDay);
  const monthOffset = d.getUTCDate() >= day ? 0 : -1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, day)).toISOString().slice(0, 10);
}

/** When the current budget cycle ends. */
export function nextCycleReset(now: number, resetDay: number): string {
  const start = new Date(`${cycleStart(now, resetDay)}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, clampDay(resetDay))).toISOString();
}

/* ---------- Housekeeping ---------- */

const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

function charge(state: UsageState, attempt: Attempt, usd: number) {
  state.cycle.spentUsd = round(state.cycle.spentUsd + usd);
  attempt.chargedUsd = round(attempt.chargedUsd + usd);
}

/**
 * Bring the state up to date: roll over the day and the budget cycle, and
 * close out abandoned attempts. A phase that ran past its deadline is charged
 * its full hold (we can't know what it spent). A creative phase that never
 * started is released without charge (nothing was spent).
 */
export function refresh(state: UsageState, now: number, config: UsageConfig): string[] {
  const events: string[] = [];
  const cycle = cycleStart(now, config.cycleResetDay);
  if (state.cycle.key !== cycle) {
    state.history = [state.cycle, ...state.history].slice(0, 12);
    state.cycle = { key: cycle, spentUsd: 0, attempts: 0 };
    events.push(`cycle rolled over to ${cycle}`);
  }
  const day = dayKey(now);
  if (state.day !== day) {
    state.day = day;
    state.visitors = {};
    state.networks = {};
  }
  for (const attempt of Object.values(state.attempts)) {
    if (attempt.stage === "done") {
      // Keep finished attempts for two days (for handoff-reuse checks), then forget them.
      if (now - attempt.createdAt > 2 * 86_400_000) delete state.attempts[attempt.id];
      continue;
    }
    if (attempt.inflight && now > attempt.inflight.expiresAt) {
      charge(state, attempt, attempt.inflight.reserveUsd);
      attempt.abandonedChargeUsd = attempt.inflight.reserveUsd;
      attempt.inflight = null;
      attempt.heldUsd = 0;
      attempt.stage = "done";
      events.push(`attempt ${attempt.id} abandoned; charged its full hold`);
    } else if (attempt.stage === "between" && now > attempt.holdExpiresAt) {
      attempt.heldUsd = 0;
      attempt.stage = "done";
      events.push(`attempt ${attempt.id} never started its creative phase; hold released`);
    }
  }
  return events;
}

/** Spent plus everything currently on hold. */
export function committedUsd(state: UsageState): number {
  return round(
    state.cycle.spentUsd +
      Object.values(state.attempts).reduce((sum, a) => sum + (a.inflight?.reserveUsd ?? 0) + a.heldUsd, 0),
  );
}

function activeAttemptFor(state: UsageState, visitor: string): Attempt | undefined {
  return Object.values(state.attempts).find((a) => a.visitor === visitor && a.stage !== "done");
}

/* ---------- Decisions ---------- */

const BUSY: Refusal = {
  ok: false,
  kind: "busy",
  message: "A scan is already running for you in another tab or window. Let it finish, or cancel it there, then try again.",
};

/**
 * Start a new paid attempt. Checks, in order: one active scan per visitor;
 * the shared budget (which always wins); the visitor's daily allowance; the
 * network's daily allowance. On success, counts the attempt and puts the
 * worst-case cost on hold.
 */
export function startAttempt(
  state: UsageState,
  input: { id: string; visitor: string; network: string; withResearch: boolean; now: number },
  config: UsageConfig,
): { ok: true; attempt: Attempt } | Refusal {
  const { now } = input;
  refresh(state, now, config);

  if (activeAttemptFor(state, input.visitor)) return BUSY;

  const first: Phase = input.withResearch ? "research" : "creative";
  const needed = input.withResearch ? RESERVE_USD.research + RESERVE_USD.creative : RESERVE_USD.creative;
  if (committedUsd(state) + needed > config.budgetUsd + 1e-9) {
    return {
      ok: false,
      kind: "budget",
      resetsAt: nextCycleReset(now, config.cycleResetDay),
      message: "The public beta has used its shared budget for this cycle, so live scans are paused.",
    };
  }
  if ((state.visitors[input.visitor] ?? 0) >= config.dailyAttempts) {
    return {
      ok: false,
      kind: "daily",
      limit: config.dailyAttempts,
      resetsAt: nextDailyReset(now),
      message: `You've used all ${config.dailyAttempts} beta ${config.dailyAttempts === 1 ? "scan" : "scans"} for today.`,
    };
  }
  if ((state.networks[input.network] ?? 0) >= config.networkDailyAttempts) {
    return {
      ok: false,
      kind: "network",
      resetsAt: nextDailyReset(now),
      message: "This network has reached today's scan limit for the beta.",
    };
  }

  const attempt: Attempt = {
    id: input.id,
    visitor: input.visitor,
    network: input.network,
    createdAt: now,
    stage: first,
    inflight: { phase: first, reserveUsd: RESERVE_USD[first], expiresAt: now + PHASE_TTL_MS },
    heldUsd: input.withResearch ? RESERVE_USD.creative : 0,
    holdExpiresAt: now + PHASE_TTL_MS + HANDOFF_TTL_MS,
    chargedUsd: 0,
  };
  state.attempts[attempt.id] = attempt;
  state.visitors[input.visitor] = (state.visitors[input.visitor] ?? 0) + 1;
  state.networks[input.network] = (state.networks[input.network] ?? 0) + 1;
  state.cycle.attempts += 1;
  return { ok: true, attempt };
}

/**
 * Start the creative phase of an attempt whose research has finished. Each
 * attempt gets exactly one creative phase: a reused or foreign handoff is
 * refused, so it can't trigger more paid calls.
 */
export function startCreative(
  state: UsageState,
  input: { attemptId: string; visitor: string; now: number },
  config: UsageConfig,
): { ok: true; attempt: Attempt } | Refusal {
  refresh(state, input.now, config);
  const attempt = state.attempts[input.attemptId];
  if (!attempt || attempt.visitor !== input.visitor) {
    return { ok: false, kind: "handoff", message: "This scan's research handoff isn't valid here. Start a new scan." };
  }
  if (attempt.stage === "research") return BUSY;
  if (attempt.stage !== "between") {
    return { ok: false, kind: "handoff", message: "This scan's research has already been used or has expired. Start a new scan." };
  }
  attempt.stage = "creative";
  attempt.inflight = { phase: "creative", reserveUsd: attempt.heldUsd, expiresAt: input.now + PHASE_TTL_MS };
  attempt.heldUsd = 0;
  return { ok: true, attempt };
}

/**
 * Swap a phase's hold for what it actually cost. `continues` is true when
 * research ended (successfully or not) and the creative phase should follow;
 * false ends the attempt and releases anything still held.
 */
export function settlePhase(
  state: UsageState,
  input: { attemptId: string; costUsd: number; continues: boolean; now: number },
  config: UsageConfig,
): { charged: number } {
  // Close out the phase before housekeeping, so a slow-but-finished phase is
  // charged what it actually cost rather than treated as abandoned.
  const attempt = state.attempts[input.attemptId];
  const cost = Math.max(0, input.costUsd);
  let charged = 0;
  if (attempt?.inflight) {
    const phase = attempt.inflight.phase;
    attempt.inflight = null;
    charge(state, attempt, cost);
    charged = cost;
    if (phase === "research" && input.continues) {
      attempt.stage = "between";
      attempt.holdExpiresAt = input.now + HANDOFF_TTL_MS;
    } else {
      attempt.stage = "done";
      attempt.heldUsd = 0;
    }
  } else if (attempt?.abandonedChargeUsd !== undefined) {
    // Already charged its full hold as abandoned; add only any excess.
    const extra = Math.max(0, cost - attempt.abandonedChargeUsd);
    charge(state, attempt, extra);
    attempt.abandonedChargeUsd += extra;
    charged = extra;
  }
  refresh(state, input.now, config);
  return { charged };
}

/** What a visitor can see about their allowance. */
export function allowanceFor(
  state: UsageState,
  input: { visitor: string; now: number },
  config: UsageConfig,
): { remaining: number; limit: number; resetsAt: string; budgetAvailable: boolean; budgetResetsAt: string; active: boolean } {
  refresh(state, input.now, config);
  return {
    remaining: Math.max(0, config.dailyAttempts - (state.visitors[input.visitor] ?? 0)),
    limit: config.dailyAttempts,
    resetsAt: nextDailyReset(input.now),
    budgetAvailable: committedUsd(state) + RESERVE_USD.research + RESERVE_USD.creative <= config.budgetUsd + 1e-9,
    budgetResetsAt: nextCycleReset(input.now, config.cycleResetDay),
    active: Boolean(activeAttemptFor(state, input.visitor)),
  };
}
