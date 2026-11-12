import { createHash, randomBytes } from "node:crypto";
import { chargeFor, type Meter } from "./meter.ts";
import {
  allowanceFor,
  RESERVE_USD,
  settlePhase,
  startAttempt,
  startCreative,
  type Refusal,
  type UsageConfig,
} from "./policy.ts";
import { DEFAULT_KEY_PREFIX, MemoryStore, RedisRestStore, UsageUnavailable, type UsageStore } from "./store.ts";

/**
 * The doorman for paid work: both paid routes ask it before calling Claude
 * and report back to it afterward.
 *
 * Modes (SPARK_USAGE_STORE):
 * - "redis"  → limits enforced, shared across every server instance (Upstash).
 * - "memory" → limits enforced in this one process: tests and local trials only.
 * - "off"    → no limits: your own local use. Refused on Vercel.
 * - unset    → "off" locally; on Vercel, paid scans are refused (fail closed).
 *
 * Who is a "visitor"? An anonymous random ID in a cookie. That identifies a
 * browser, not a person: clearing cookies or using another browser gets a
 * fresh allowance. The per-network limit and the shared budget are the
 * backstops; only the shared budget is a firm cap.
 */

export type UsageGate =
  | { mode: "off" }
  | { mode: "enforced"; store: UsageStore; config: UsageConfig; storeKind: "redis" | "memory" }
  | { mode: "unavailable"; reason: string };

type Env = Record<string, string | undefined>;

function positive(value: string | undefined, fallback: number, { integer = false, max = Infinity } = {}): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max || (integer && !Number.isInteger(n))) return null;
  return n;
}

/** Read limits and storage from the environment. Any invalid setting fails closed. */
export function resolveGate(env: Env, now: () => number = Date.now): UsageGate {
  const onVercel = Boolean(env.VERCEL);
  const kind = (env.SPARK_USAGE_STORE ?? "").trim().toLowerCase();

  if (kind === "" || kind === "off") {
    return onVercel
      ? { mode: "unavailable", reason: kind === "off" ? "usage limits can't be switched off on a public deployment" : "usage storage isn't configured" }
      : { mode: "off" };
  }

  const dailyAttempts = positive(env.SPARK_DAILY_SCANS, 3, { integer: true, max: 100 });
  const networkDailyAttempts = positive(env.SPARK_NETWORK_DAILY_SCANS, 6, { integer: true, max: 1000 });
  // $27 by default: a little under the $30 Anthropic workspace cap, so the app's own message comes first.
  const budgetUsd = positive(env.SPARK_PUBLIC_BUDGET_USD, 27, { max: 10_000 });
  const cycleResetDay = positive(env.SPARK_BUDGET_RESET_DAY, 1, { integer: true, max: 28 });
  if (dailyAttempts === null || networkDailyAttempts === null || budgetUsd === null || cycleResetDay === null) {
    return { mode: "unavailable", reason: "a usage-limit setting is invalid" };
  }
  const config: UsageConfig = { dailyAttempts, networkDailyAttempts, budgetUsd, cycleResetDay };

  if (kind === "memory") {
    if (onVercel) return { mode: "unavailable", reason: "in-memory usage tracking can't be shared across server instances" };
    return { mode: "enforced", store: new MemoryStore(config, now), config, storeKind: "memory" };
  }
  if (kind === "redis") {
    const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
    const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return { mode: "unavailable", reason: "usage storage credentials are missing" };
    const prefix = env.SPARK_USAGE_KEY_PREFIX?.trim() || DEFAULT_KEY_PREFIX;
    if (!/^[A-Za-z0-9:_-]{1,64}$/.test(prefix)) return { mode: "unavailable", reason: "SPARK_USAGE_KEY_PREFIX is invalid" };
    return { mode: "enforced", store: new RedisRestStore(url, token, config, now, prefix), config, storeKind: "redis" };
  }
  return { mode: "unavailable", reason: "SPARK_USAGE_STORE has an unknown value" };
}

let cached: UsageGate | null = null;
/** One gate per server process (the memory store must be shared by both routes). */
export function usageGate(): UsageGate {
  cached ??= resolveGate(process.env);
  return cached;
}

/* ---------- Visitor identity ---------- */

export const VISITOR_COOKIE = "dss_visitor";
const VISITOR_PATTERN = /^[a-f0-9]{32}$/;

export interface Visitor {
  visitor: string;
  network: string;
  /** Set-Cookie header to send when this is a new visitor. */
  setCookie: string | null;
}

export function identify(request: Request, env: Env = process.env): Visitor {
  const cookie = request.headers.get("cookie") ?? "";
  const existing = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === VISITOR_COOKIE)?.[1];
  const visitor = existing && VISITOR_PATTERN.test(existing) ? existing : randomBytes(16).toString("hex");
  const setCookie =
    visitor === existing
      ? null
      : `${VISITOR_COOKIE}=${visitor}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${env.VERCEL ? "; Secure" : ""}`;

  // On Vercel, x-real-ip is set by Vercel itself and can't be spoofed by the visitor.
  // Elsewhere the header can't be trusted, so every local request shares one "network".
  const ip = env.VERCEL ? (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "") : "";
  const network = ip
    ? createHash("sha256").update(`${env.SPARK_LEDGER_SECRET ?? ""}:network:${ip}`).digest("hex").slice(0, 16)
    : "local";
  // Without the header every visitor would share one network allowance (6 a day for everyone).
  if (env.VERCEL && !ip) console.warn("[usage] no client IP header on Vercel; all visitors share one network allowance");
  return { visitor, network, setCookie };
}

/* ---------- Begin and settle ---------- */

export interface LimitBody {
  error: string;
  limit: { kind: Refusal["kind"] | "unavailable"; resetsAt?: string; limit?: number };
}

export type Begin =
  | { ok: true; attemptId: string | null; reserveUsd: number }
  | { ok: false; status: number; body: LimitBody };

const STATUS: Record<Refusal["kind"], number> = { busy: 409, handoff: 409, budget: 429, daily: 429, network: 429 };

function refuse(refusal: Refusal): Begin {
  const { kind, message } = refusal;
  const resetsAt = "resetsAt" in refusal ? refusal.resetsAt : undefined;
  const limit = "limit" in refusal ? refusal.limit : undefined;
  return { ok: false, status: STATUS[kind], body: { error: message, limit: { kind, resetsAt, limit } } };
}

function unavailable(): Begin {
  return {
    ok: false,
    status: 503,
    body: {
      error: "Live scans are paused because usage tracking is unavailable right now. No scan was started and nothing was charged.",
      limit: { kind: "unavailable" },
    },
  };
}

/** Start a new paid attempt (research first, or creative only). */
export async function beginAttempt(gate: UsageGate, who: Visitor, withResearch: boolean, now = Date.now()): Promise<Begin> {
  if (gate.mode === "off") return { ok: true, attemptId: null, reserveUsd: 0 };
  if (gate.mode === "unavailable") {
    console.warn(`[usage] refusing paid work: ${gate.reason}`);
    return unavailable();
  }
  const id = randomBytes(12).toString("hex");
  try {
    const result = await gate.store.transact((state) =>
      startAttempt(state, { id, visitor: who.visitor, network: who.network, withResearch, now }, gate.config),
    );
    if (!result.ok) {
      console.info(`[usage] refused: ${result.kind}`);
      return refuse(result);
    }
    console.info(`[usage] attempt ${id} started (${withResearch ? "research" : "creative"})`);
    return { ok: true, attemptId: id, reserveUsd: withResearch ? RESERVE_USD.research : RESERVE_USD.creative };
  } catch (error) {
    console.warn(`[usage] ${error instanceof UsageUnavailable ? error.message : "unexpected storage error"}`);
    return unavailable();
  }
}

/** Start the one creative phase of an attempt whose research has finished. */
export async function beginCreative(gate: UsageGate, who: Visitor, attemptId: string, now = Date.now()): Promise<Begin> {
  if (gate.mode === "off") return { ok: true, attemptId: null, reserveUsd: 0 };
  if (gate.mode === "unavailable") return unavailable();
  try {
    const result = await gate.store.transact((state) =>
      startCreative(state, { attemptId, visitor: who.visitor, now }, gate.config),
    );
    if (!result.ok) {
      console.info(`[usage] refused: ${result.kind}`);
      return refuse(result);
    }
    return { ok: true, attemptId, reserveUsd: result.attempt.inflight?.reserveUsd ?? RESERVE_USD.creative };
  } catch (error) {
    console.warn(`[usage] ${error instanceof UsageUnavailable ? error.message : "unexpected storage error"}`);
    return unavailable();
  }
}

/**
 * Record what a phase cost. Never throws: if storage is down, the hold
 * stays in place and is charged in full when it expires, so a lost update
 * can only overcount, never undercount.
 */
export async function settle(
  gate: UsageGate,
  begin: Begin,
  meter: Meter,
  continues: boolean,
  now = Date.now(),
): Promise<void> {
  if (gate.mode !== "enforced" || !begin.ok || !begin.attemptId) return;
  const cost = chargeFor(meter, begin.reserveUsd);
  const attemptId = begin.attemptId;
  if (meter.unknownModels.length) console.warn(`[usage] priced unfamiliar model(s) conservatively: ${meter.unknownModels.join(", ")}`);
  try {
    await gate.store.transact((state) => settlePhase(state, { attemptId, costUsd: cost, continues, now }, gate.config));
    console.info(`[usage] attempt ${attemptId} charged $${cost.toFixed(4)}${meter.uncertain ? " (full hold: a call ended without a readable response)" : ""}`);
  } catch {
    console.warn(`[usage] couldn't record attempt ${attemptId}; its hold will be charged in full when it expires`);
  }
}

/** The visitor's remaining allowance, for the page. Null when limits are off or unreadable. */
export async function allowance(gate: UsageGate, who: Visitor, now = Date.now()) {
  if (gate.mode !== "enforced") return null;
  try {
    return await gate.store.transact((state) => allowanceFor(state, { visitor: who.visitor, now }, gate.config));
  } catch {
    return null;
  }
}

/** JSON response, with the visitor cookie attached when it's new. */
export function json(body: unknown, init: { status?: number; who?: Visitor } = {}): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (init.who?.setCookie) headers.append("set-cookie", init.who.setCookie);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}
