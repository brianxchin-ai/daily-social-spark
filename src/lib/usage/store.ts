import { randomBytes } from "node:crypto";
import { emptyState, type UsageConfig, type UsageState } from "./policy.ts";

/**
 * Where usage is recorded, and how changes are kept safe under concurrency.
 *
 * Every change is a "transaction": read the whole state, apply one decision
 * from policy.ts, write it back, with nobody else allowed in between. That
 * one-at-a-time rule is what stops two simultaneous scans from both fitting
 * under the budget when only one should.
 *
 * - MemoryStore: one process only. For tests and local use; never on Vercel.
 * - RedisRestStore: Upstash Redis over its REST API (plain fetch, no new
 *   dependency). Shared by every Vercel instance. A short lock serializes
 *   transactions, and the write only lands if we still hold the lock.
 *
 * If storage can't be reached, transactions throw UsageUnavailable and the
 * routes refuse paid work: we fail closed, never open.
 */

export class UsageUnavailable extends Error {
  constructor(detail: string) {
    super(`Usage tracking is unavailable: ${detail}`);
    this.name = "UsageUnavailable";
  }
}

export interface UsageStore {
  transact<T>(fn: (state: UsageState) => T): Promise<T>;
}

/* ---------- In-memory (single process) ---------- */

export class MemoryStore implements UsageStore {
  private state: UsageState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly config: UsageConfig;
  private readonly now: () => number;

  constructor(config: UsageConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  transact<T>(fn: (state: UsageState) => T): Promise<T> {
    const run = this.queue.then(() => {
      // Work on a copy, so a decision that throws leaves the state untouched.
      const draft: UsageState = structuredClone(this.state ?? emptyState(this.now(), this.config));
      const result = fn(draft);
      this.state = draft;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Test helper: read a copy of the state. */
  snapshot(): UsageState | null {
    return this.state ? structuredClone(this.state) : null;
  }
}

/* ---------- Upstash Redis over REST ---------- */

const STATE_KEY = "dss:usage:v1:state";
const LOCK_KEY = "dss:usage:v1:lock";
const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 4_000;
const REQUEST_TIMEOUT_MS = 3_000;

/** Write the new state and release the lock, only if the lock is still ours. */
const COMMIT_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("SET", KEYS[2], ARGV[2]) redis.call("DEL", KEYS[1]) return 1 else return 0 end`;
/** Release the lock only if it's still ours. */
const RELEASE_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

export class RedisRestStore implements UsageStore {
  private readonly url: string;
  private readonly token: string;
  private readonly config: UsageConfig;
  private readonly now: () => number;

  constructor(url: string, token: string, config: UsageConfig, now: () => number = Date.now) {
    this.url = url;
    this.token = token;
    this.config = config;
    this.now = now;
  }

  private async command(args: (string | number)[]): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new UsageUnavailable("storage didn't respond");
    }
    const body = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!response.ok || !body || body.error !== undefined) {
      // Never echo the store's error text: it could include connection details.
      throw new UsageUnavailable(`storage returned an error (HTTP ${response.status})`);
    }
    return body.result;
  }

  async transact<T>(fn: (state: UsageState) => T): Promise<T> {
    const lockId = randomBytes(12).toString("hex");
    const giveUpAt = Date.now() + LOCK_WAIT_MS;
    for (let wait = 25; ; wait = Math.min(wait * 2, 250)) {
      const got = await this.command(["SET", LOCK_KEY, lockId, "NX", "PX", LOCK_TTL_MS]);
      if (got === "OK") break;
      if (Date.now() > giveUpAt) throw new UsageUnavailable("storage is busy");
      await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * wait));
    }

    let committed = false;
    try {
      const raw = await this.command(["GET", STATE_KEY]);
      let state: UsageState;
      if (typeof raw === "string") {
        try {
          state = JSON.parse(raw) as UsageState;
        } catch {
          throw new UsageUnavailable("stored usage couldn't be read");
        }
        if (state?.v !== 1) throw new UsageUnavailable("stored usage has an unexpected format");
      } else {
        state = emptyState(this.now(), this.config);
      }
      const result = fn(state);
      const ok = await this.command(["EVAL", COMMIT_SCRIPT, 2, LOCK_KEY, STATE_KEY, lockId, JSON.stringify(state)]);
      if (ok !== 1) throw new UsageUnavailable("the usage update took too long and was discarded");
      committed = true;
      return result;
    } finally {
      if (!committed) await this.command(["EVAL", RELEASE_SCRIPT, 1, LOCK_KEY, lockId]).catch(() => undefined);
    }
  }
}
