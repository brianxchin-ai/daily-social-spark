import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startFakeUpstash } from "./fake-upstash.ts";
import { allowance, beginAttempt, beginCreative, identify, resolveGate, settle, type UsageGate, type Visitor } from "./guard.ts";
import { chargeFor, newMeter, recordCost, recordUncertain, withMeter } from "./meter.ts";
import {
  committedUsd,
  cycleStart,
  emptyState,
  HANDOFF_TTL_MS,
  nextCycleReset,
  nextDailyReset,
  PHASE_TTL_MS,
  RESERVE_USD,
  settlePhase,
  startAttempt,
  startCreative,
  type UsageConfig,
} from "./policy.ts";
import { estimateCostUsd, priceFor } from "./pricing.ts";
import { MemoryStore, RedisRestStore } from "./store.ts";

const CONFIG: UsageConfig = { dailyAttempts: 3, networkDailyAttempts: 6, budgetUsd: 30, cycleResetDay: 1 };
const T0 = Date.UTC(2026, 10, 12, 15, 0, 0); // Nov 12, 2026, 15:00 UTC
const FULL = RESERVE_USD.research + RESERVE_USD.creative;

const memoryGate = (config: Partial<UsageConfig> = {}): Extract<UsageGate, { mode: "enforced" }> => {
  const full = { ...CONFIG, ...config };
  return { mode: "enforced", store: new MemoryStore(full, () => T0), config: full, storeKind: "memory" };
};
const visitor = (id: string, network = "net-a"): Visitor => ({ visitor: `${id}-`.padEnd(32, "0"), network, setCookie: null });
const meterOf = (knownUsd: number, uncertain = false) => ({ knownUsd, uncertain, unknownModels: [] as string[] });

/* ---------- 1. Normal research + creative ---------- */

describe("normal research then creative", () => {
  it("runs one attempt across both requests and charges measured cost", async () => {
    const gate = memoryGate();
    const who = visitor("a");
    const research = await beginAttempt(gate, who, true, T0);
    assert.ok(research.ok && research.attemptId);
    await settle(gate, research, meterOf(0.21), true, T0 + 60_000);

    const creative = await beginCreative(gate, who, research.attemptId!, T0 + 61_000);
    assert.ok(creative.ok);
    await settle(gate, creative, meterOf(0.17), false, T0 + 140_000);

    const state = gate.store instanceof MemoryStore ? gate.store.snapshot()! : null;
    assert.equal(state!.cycle.spentUsd, 0.38);
    assert.equal(committedUsd(state!), 0.38, "no holds left once the attempt finishes");
    const left = await allowance(gate, who, T0 + 150_000);
    assert.equal(left?.remaining, 2);
    assert.equal(left?.active, false);
  });

  it("puts the worst case on hold while work is running", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "x", visitor: "v", network: "n", withResearch: true, now: T0 }, CONFIG);
    assert.equal(committedUsd(state), FULL);
  });
});

/* ---------- 2. Three attempts per day ---------- */

describe("daily allowance", () => {
  it("allows 3 attempts, refuses the 4th with the reset time, and resets at 00:00 UTC", async () => {
    const gate = memoryGate();
    const who = visitor("b");
    for (let i = 0; i < 3; i++) {
      const begin = await beginAttempt(gate, who, false, T0 + i * 1000);
      assert.ok(begin.ok);
      await settle(gate, begin, meterOf(0.1), false, T0 + i * 1000 + 500);
    }
    const fourth = await beginAttempt(gate, who, false, T0 + 10_000);
    assert.equal(fourth.ok, false);
    if (!fourth.ok) {
      assert.equal(fourth.status, 429);
      assert.equal(fourth.body.limit.kind, "daily");
      assert.equal(fourth.body.limit.resetsAt, "2026-11-13T00:00:00.000Z");
    }
    const tomorrow = await beginAttempt(gate, who, false, Date.UTC(2026, 10, 13, 0, 0, 1));
    assert.ok(tomorrow.ok, "a new UTC day brings a fresh allowance");
  });

  it("counts failed and canceled attempts too", async () => {
    const gate = memoryGate();
    const who = visitor("c");
    const a = await beginAttempt(gate, who, true, T0);
    await settle(gate, a, meterOf(0.05, true), false, T0 + 1000); // canceled during research
    const b = await beginAttempt(gate, who, false, T0 + 2000);
    await settle(gate, b, meterOf(0.02), false, T0 + 3000); // failed creative
    assert.equal((await allowance(gate, who, T0 + 4000))?.remaining, 1);
  });

  it("limits a network across cleared cookies", async () => {
    const gate = memoryGate({ networkDailyAttempts: 4 });
    for (let i = 0; i < 4; i++) {
      const begin = await beginAttempt(gate, visitor(`fresh${i}`, "shared"), false, T0 + i);
      assert.ok(begin.ok);
      await settle(gate, begin, meterOf(0), false, T0 + i);
    }
    const fifth = await beginAttempt(gate, visitor("fresh9", "shared"), false, T0 + 10);
    assert.equal(!fifth.ok && fifth.body.limit.kind, "network");
  });
});

/* ---------- 3. Shared budget ---------- */

describe("shared budget", () => {
  it("refuses new attempts once spent + holds would pass the cap, even with allowance left", async () => {
    const gate = memoryGate({ budgetUsd: 3 });
    const first = await beginAttempt(gate, visitor("d1"), false, T0);
    await settle(gate, first, meterOf(2.5), false, T0 + 1);
    const second = await beginAttempt(gate, visitor("d2"), false, T0 + 2);
    assert.equal(!second.ok && second.body.limit.kind, "budget");
    assert.equal(!second.ok && second.body.limit.resetsAt, "2026-12-01T00:00:00.000Z");
    assert.equal((await allowance(gate, visitor("d2"), T0 + 3))?.budgetAvailable, false);
  });

  it("takes precedence over the daily allowance message", async () => {
    const gate = memoryGate({ budgetUsd: 0.5 });
    const begin = await beginAttempt(gate, visitor("e"), false, T0);
    assert.equal(!begin.ok && begin.body.limit.kind, "budget");
  });

  it("records an overrun beyond the hold, and later attempts see it", async () => {
    const gate = memoryGate({ budgetUsd: 2 });
    const a = await beginAttempt(gate, visitor("f1"), false, T0);
    await settle(gate, a, meterOf(1.5), false, T0 + 1); // cost more than the 0.60 hold
    const b = await beginAttempt(gate, visitor("f2"), false, T0 + 2);
    assert.equal(b.ok, false, "1.50 spent + 0.60 hold > 2.00");
  });
});

/* ---------- 4. Concurrency: tabs and server instances ---------- */

describe("concurrency", () => {
  it("allows one active scan per visitor across tabs", async () => {
    const gate = memoryGate();
    const who = visitor("g");
    const tabs = await Promise.all(Array.from({ length: 5 }, () => beginAttempt(gate, who, true, T0)));
    assert.equal(tabs.filter((t) => t.ok).length, 1);
    assert.ok(tabs.filter((t) => !t.ok).every((t) => !t.ok && t.status === 409 && t.body.limit.kind === "busy"));
  });

  it("never lets simultaneous scans across server instances exceed the budget (Redis REST)", async () => {
    const fake = await startFakeUpstash({ maxDelayMs: 6 });
    try {
      const config = { ...CONFIG, budgetUsd: RESERVE_USD.creative * 4 + 0.1, networkDailyAttempts: 100 };
      // Five separate "instances", each with its own store client, sharing one database.
      const instances: UsageGate[] = Array.from({ length: 5 }, () => ({
        mode: "enforced",
        store: new RedisRestStore(fake.url, fake.token, config, () => T0),
        config,
        storeKind: "redis",
      }));
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => beginAttempt(instances[i % 5], visitor(`h${i}`), false, T0)),
      );
      assert.equal(results.filter((r) => r.ok).length, 4, "exactly as many as fit in the budget");
      assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.body.limit.kind === "budget"));
      const stored = JSON.parse(fake.data.get("dss:usage:v1:state")!.value);
      assert.equal(stored.cycle.attempts, 4);
    } finally {
      await fake.close();
    }
  });

  it("keeps one active scan per visitor across instances (Redis REST)", async () => {
    const fake = await startFakeUpstash();
    try {
      const gates: UsageGate[] = Array.from({ length: 3 }, () => ({
        mode: "enforced",
        store: new RedisRestStore(fake.url, fake.token, CONFIG, () => T0),
        config: CONFIG,
        storeKind: "redis",
      }));
      const who = visitor("i");
      const results = await Promise.all(gates.map((g) => beginAttempt(g, who, true, T0)));
      assert.equal(results.filter((r) => r.ok).length, 1);
    } finally {
      await fake.close();
    }
  });
});

/* ---------- 5 & 6. Direct calls and handoff reuse ---------- */

describe("direct calls and handoff reuse", () => {
  it("a creative request without research starts (and counts) a new attempt", async () => {
    const gate = memoryGate();
    const begin = await beginAttempt(gate, visitor("j"), false, T0);
    assert.ok(begin.ok);
    assert.equal((await allowance(gate, visitor("j"), T0 + 1))?.remaining, 2);
  });

  it("refuses a made-up attempt ID and someone else's attempt", async () => {
    const gate = memoryGate();
    const owner = visitor("k1");
    const research = await beginAttempt(gate, owner, true, T0);
    await settle(gate, research, meterOf(0.2), true, T0 + 1000);
    const forged = await beginCreative(gate, owner, "not-a-real-attempt", T0 + 2000);
    assert.equal(!forged.ok && forged.body.limit.kind, "handoff");
    const stranger = await beginCreative(gate, visitor("k2"), research.ok ? research.attemptId! : "", T0 + 2000);
    assert.equal(!stranger.ok && stranger.body.limit.kind, "handoff");
  });

  it("lets a research handoff feed exactly one creative request", async () => {
    const gate = memoryGate();
    const who = visitor("l");
    const research = await beginAttempt(gate, who, true, T0);
    await settle(gate, research, meterOf(0.2), true, T0 + 1000);
    const id = research.ok ? research.attemptId! : "";
    const first = await beginCreative(gate, who, id, T0 + 2000);
    assert.ok(first.ok);
    // Replayed while the first is still running: refused as busy-or-used, never a second paid run.
    const replayDuring = await beginCreative(gate, who, id, T0 + 3000);
    assert.equal(replayDuring.ok, false);
    await settle(gate, first, meterOf(0.15), false, T0 + 60_000);
    const replayAfter = await beginCreative(gate, who, id, T0 + 61_000);
    assert.equal(!replayAfter.ok && replayAfter.body.limit.kind, "handoff");
  });

  it("refuses creative while that attempt's research is still running", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "m", visitor: "v", network: "n", withResearch: true, now: T0 }, CONFIG);
    const early = startCreative(state, { attemptId: "m", visitor: "v", now: T0 + 1 }, CONFIG);
    assert.equal(!early.ok && early.kind, "busy");
  });
});

/* ---------- 7. Cancellations, failures, abandoned work ---------- */

describe("cancellations, failures and abandoned holds", () => {
  it("canceled research ends the attempt and releases the creative hold", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "n", visitor: "v", network: "x", withResearch: true, now: T0 }, CONFIG);
    settlePhase(state, { attemptId: "n", costUsd: 0.08, continues: false, now: T0 + 5000 }, CONFIG);
    assert.equal(state.attempts.n.stage, "done");
    assert.equal(committedUsd(state), 0.08);
  });

  it("failed research still allows the creative request (labeled unverified) in the same attempt", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "o", visitor: "v", network: "x", withResearch: true, now: T0 }, CONFIG);
    settlePhase(state, { attemptId: "o", costUsd: 0.12, continues: true, now: T0 + 5000 }, CONFIG);
    assert.ok(startCreative(state, { attemptId: "o", visitor: "v", now: T0 + 6000 }, CONFIG).ok);
  });

  it("charges the full hold when a call ended without a readable response", () => {
    assert.equal(chargeFor(meterOf(0.1, true), RESERVE_USD.research), RESERVE_USD.research);
    assert.equal(chargeFor(meterOf(0.1, false), RESERVE_USD.research), 0.1);
    assert.equal(chargeFor(meterOf(0.95, true), RESERVE_USD.research), 0.95, "never less than what was measured");
  });

  it("charges an abandoned phase its full hold after the deadline, and frees the visitor", async () => {
    const gate = memoryGate();
    const who = visitor("p");
    const begin = await beginAttempt(gate, who, true, T0); // never settled: the server was killed
    assert.ok(begin.ok);
    const later = T0 + PHASE_TTL_MS + 1;
    const again = await beginAttempt(gate, who, false, later);
    assert.ok(again.ok, "the stuck scan no longer blocks the visitor");
    const state = (gate.store as MemoryStore).snapshot()!;
    assert.equal(state.cycle.spentUsd, RESERVE_USD.research, "charged in full, since its real cost is unknown");
  });

  it("releases a creative hold that was never used, without charge", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "q", visitor: "v", network: "x", withResearch: true, now: T0 }, CONFIG);
    settlePhase(state, { attemptId: "q", costUsd: 0.2, continues: true, now: T0 + 1000 }, CONFIG);
    startAttempt(state, { id: "r", visitor: "w", network: "x", withResearch: false, now: T0 + 1000 + HANDOFF_TTL_MS + 1 }, CONFIG);
    assert.equal(state.attempts.q.stage, "done");
    assert.equal(state.cycle.spentUsd, 0.2);
  });

  it("adds only the excess when a late report arrives for an abandoned phase", () => {
    const state = emptyState(T0, CONFIG);
    startAttempt(state, { id: "s", visitor: "v", network: "x", withResearch: false, now: T0 }, CONFIG);
    settlePhase(state, { attemptId: "z", costUsd: 0, continues: false, now: T0 + PHASE_TTL_MS + 1 }, CONFIG); // housekeeping
    assert.equal(state.cycle.spentUsd, RESERVE_USD.creative);
    settlePhase(state, { attemptId: "s", costUsd: 0.9, continues: false, now: T0 + PHASE_TTL_MS + 2 }, CONFIG);
    assert.equal(state.cycle.spentUsd, 0.9);
  });
});

/* ---------- 8. Storage unavailable ---------- */

describe("storage unavailable", () => {
  it("refuses paid work when storage is unreachable", async () => {
    const gate: UsageGate = {
      mode: "enforced",
      store: new RedisRestStore("http://127.0.0.1:9", "t", CONFIG),
      config: CONFIG,
      storeKind: "redis",
    };
    const begin = await beginAttempt(gate, visitor("t"), true, T0);
    assert.equal(!begin.ok && begin.status, 503);
    assert.equal(!begin.ok && begin.body.limit.kind, "unavailable");
  });

  it("refuses paid work when storage returns errors, and settle never throws", async () => {
    const fake = await startFakeUpstash();
    try {
      const gate: UsageGate = { mode: "enforced", store: new RedisRestStore(fake.url, fake.token, CONFIG), config: CONFIG, storeKind: "redis" };
      fake.fail.next = 1;
      assert.equal((await beginAttempt(gate, visitor("u"), false, T0)).ok, false);
      const ok = await beginAttempt(gate, visitor("u"), false, T0);
      assert.ok(ok.ok);
      fake.fail.next = 10;
      await settle(gate, ok, meterOf(0.1), false, T0 + 1); // logs, doesn't throw; the hold expires and is charged
    } finally {
      await fake.close();
    }
  });

  it("refuses with a wrong storage token", async () => {
    const fake = await startFakeUpstash();
    try {
      const gate: UsageGate = { mode: "enforced", store: new RedisRestStore(fake.url, "wrong", CONFIG), config: CONFIG, storeKind: "redis" };
      assert.equal((await beginAttempt(gate, visitor("v"), false, T0)).ok, false);
    } finally {
      await fake.close();
    }
  });

  it("fails closed on Vercel when storage isn't configured or settings are invalid", () => {
    assert.equal(resolveGate({ VERCEL: "1" }).mode, "unavailable");
    assert.equal(resolveGate({ VERCEL: "1", SPARK_USAGE_STORE: "off" }).mode, "unavailable");
    assert.equal(resolveGate({ VERCEL: "1", SPARK_USAGE_STORE: "memory" }).mode, "unavailable");
    assert.equal(resolveGate({ VERCEL: "1", SPARK_USAGE_STORE: "redis" }).mode, "unavailable");
    assert.equal(resolveGate({ SPARK_USAGE_STORE: "memory", SPARK_PUBLIC_BUDGET_USD: "lots" }).mode, "unavailable");
    assert.equal(resolveGate({ SPARK_USAGE_STORE: "memory", SPARK_BUDGET_RESET_DAY: "31" }).mode, "unavailable");
    assert.equal(resolveGate({ SPARK_USAGE_STORE: "mystery" }).mode, "unavailable");
    const redis = resolveGate({ VERCEL: "1", SPARK_USAGE_STORE: "redis", KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" });
    assert.equal(redis.mode === "enforced" && redis.storeKind, "redis");
  });
});

/* ---------- 9. Budget cycles ---------- */

describe("budget cycles", () => {
  it("computes cycle windows from the reset day", () => {
    assert.equal(cycleStart(T0, 1), "2026-11-01");
    assert.equal(nextCycleReset(T0, 1), "2026-12-01T00:00:00.000Z");
    assert.equal(cycleStart(T0, 15), "2026-10-15");
    assert.equal(nextCycleReset(T0, 15), "2026-11-15T00:00:00.000Z");
    assert.equal(cycleStart(Date.UTC(2027, 0, 3), 15), "2026-12-15", "crosses the year boundary");
    assert.equal(nextDailyReset(T0), "2026-11-13T00:00:00.000Z");
  });

  it("starts a fresh budget at the reset and keeps the old total in history", async () => {
    const gate = memoryGate({ budgetUsd: 1, cycleResetDay: 15 });
    const a = await beginAttempt(gate, visitor("w"), false, T0);
    await settle(gate, a, meterOf(0.6), false, T0 + 1);
    assert.equal((await beginAttempt(gate, visitor("w2"), false, T0 + 2)).ok, false, "budget used up");
    const afterReset = Date.UTC(2026, 10, 15, 0, 0, 1);
    assert.ok((await beginAttempt(gate, visitor("w2"), false, afterReset)).ok);
    const state = (gate.store as MemoryStore).snapshot()!;
    assert.equal(state.cycle.key, "2026-11-15");
    assert.equal(state.history[0].spentUsd, 0.6);
  });
});

/* ---------- 10. Personal vs. public ---------- */

describe("personal and public usage", () => {
  it("leaves your own local scans unlimited and unrecorded", async () => {
    const gate = resolveGate({});
    assert.equal(gate.mode, "off");
    const begin = await beginAttempt(gate, visitor("me"), true, T0);
    assert.ok(begin.ok && begin.attemptId === null, "no attempt recorded");
    assert.equal(await allowance(gate, visitor("me"), T0), null);
  });

  it("can't be switched off on a public deployment", () => {
    assert.equal(resolveGate({ VERCEL: "1", SPARK_USAGE_STORE: "off" }).mode, "unavailable");
  });
});

/* ---------- Identity, metering, pricing ---------- */

describe("visitor identity", () => {
  it("issues an anonymous cookie once and reuses it", () => {
    const first = identify(new Request("http://x/api/scan"), {});
    assert.match(first.visitor, /^[a-f0-9]{32}$/);
    assert.match(first.setCookie!, /HttpOnly; SameSite=Lax$/);
    const again = identify(new Request("http://x/api/scan", { headers: { cookie: `a=1; dss_visitor=${first.visitor}` } }), {});
    assert.equal(again.visitor, first.visitor);
    assert.equal(again.setCookie, null);
  });

  it("replaces a tampered cookie and marks it Secure on Vercel", () => {
    const who = identify(new Request("http://x", { headers: { cookie: "dss_visitor=../../admin" } }), { VERCEL: "1" });
    assert.notEqual(who.visitor, "../../admin");
    assert.match(who.setCookie!, /; Secure$/);
  });

  it("trusts the IP header only on Vercel, and stores it hashed", () => {
    const headers = { "x-real-ip": "203.0.113.9" };
    assert.equal(identify(new Request("http://x", { headers }), {}).network, "local");
    const onVercel = identify(new Request("http://x", { headers }), { VERCEL: "1" }).network;
    assert.match(onVercel, /^[a-f0-9]{16}$/);
    assert.ok(!onVercel.includes("203"));
  });
});

describe("cost meter", () => {
  it("keeps concurrent requests' tabs separate", async () => {
    const a = newMeter();
    const b = newMeter();
    await Promise.all([
      withMeter(a, async () => {
        recordCost(0.1, "claude-sonnet-5-5", true);
        await new Promise((r) => setTimeout(r, 5));
        recordCost(0.05, "claude-sonnet-5-5", true);
      }),
      withMeter(b, async () => {
        await new Promise((r) => setTimeout(r, 1));
        recordUncertain();
      }),
    ]);
    assert.equal(Math.round(a.knownUsd * 100) / 100, 0.15);
    assert.equal(a.uncertain, false);
    assert.equal(b.uncertain, true);
  });

  it("ignores reports outside a metered request", () => {
    recordCost(1, "claude-sonnet-5-5", true); // no throw
  });
});

describe("pricing", () => {
  it("prices by the model that answered, conservatively for unfamiliar ones", () => {
    assert.equal(priceFor("claude-sonnet-5-5-20261001").known, true);
    assert.equal(priceFor("claude-sonnet-5").known, false, "a fallback model we don't have a price for");
    assert.equal(estimateCostUsd("claude-sonnet-5-5", 1_000_000, 100_000, 3), 2 + 1 + 0.03);
    assert.ok(estimateCostUsd("claude-unknown", 10_000, 1_000) > estimateCostUsd("claude-sonnet-5-5", 10_000, 1_000));
  });
});
