import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { costOfUsage, estimateCostUsd } from "../usage/pricing.ts";
import { AGENT_LIMITS, estimateTokens, Governor, type CallPlan, type PaidCallKind } from "./governor.ts";

const MODEL = "claude-sonnet-5-5";

/** A clock tests can move. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const TURN: CallPlan = { inputTokens: 6_000, maxOutputTokens: 8_000 };
const SEARCH: CallPlan = { inputTokens: 1_500, maxOutputTokens: 2_000, maxSearches: 1, serverAddedTokens: 20_000 };
const EVALUATE: CallPlan = { inputTokens: 8_000, maxOutputTokens: 10_000 };

describe("pricing with prompt caching", () => {
  it("prices cache writes at 1.25x and cache reads at 0.05x input for Sonnet 5.5", () => {
    const usd = costOfUsage(MODEL, { inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    assert.equal(Math.round(usd * 100) / 100, 2 + 2.5 + 0.1);
  });

  it("matches the old estimate when nothing is cached", () => {
    assert.equal(costOfUsage(MODEL, { inputTokens: 12_345, outputTokens: 678, webSearches: 2 }), estimateCostUsd(MODEL, 12_345, 678, 2));
  });

  it("prices an unknown model conservatively, cached tokens included", () => {
    const usage = { inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 50_000 };
    assert.ok(costOfUsage("claude-mystery", usage) > costOfUsage(MODEL, usage) * 5);
  });

  it("estimates tokens on the high side (3 characters per token)", () => {
    assert.equal(estimateTokens("x".repeat(3_000)), 1_000);
  });
});

describe("governor: permission to spend", () => {
  it("holds a call's worst case until it settles, then charges what it cost", () => {
    const g = new Governor();
    const auth = g.authorize("search", SEARCH);
    assert.ok(auth.ok);
    assert.ok(g.committedUsd() > 0.05, "the worst case is on hold while the call runs");
    const charged = g.settle(auth.ticket, { model: MODEL, usage: { inputTokens: 9_000, outputTokens: 600, webSearches: 1 } });
    assert.equal(g.spentUsd(), charged);
    assert.equal(g.committedUsd(), charged, "the hold is released once the bill is known");
  });

  it("refuses a call whose worst case wouldn't fit, without ending the run", () => {
    const g = new Governor({ ceilingUsd: 0.1, wrapUpUsd: 0.1 });
    const auth = g.authorize("evaluate", EVALUATE);
    assert.equal(auth.ok, false);
    if (!auth.ok) {
      assert.match(auth.reason, /Not enough budget/);
      assert.equal(auth.ends, false);
    }
    assert.equal(g.committedUsd(), 0);
  });

  it("lowers an agent turn's output cap to fit the money left", () => {
    const g = new Governor({ ceilingUsd: 0.06, wrapUpUsd: 0.06 });
    const auth = g.authorize("agent-turn", TURN);
    assert.ok(auth.ok);
    assert.ok(auth.maxOutputTokens < TURN.maxOutputTokens);
    assert.ok(auth.maxOutputTokens >= AGENT_LIMITS.minTurnOutputTokens);
    assert.ok(g.committedUsd() <= 0.06 + 1e-9);
  });

  it("ends the run when even a minimal agent turn can't fit", () => {
    const g = new Governor({ ceilingUsd: 0.02, wrapUpUsd: 0.02 });
    const auth = g.authorize("agent-turn", TURN);
    assert.equal(auth.ok, false);
    if (!auth.ok) assert.equal(auth.ends, true);
    assert.equal(g.stopped(), "budget");
    assert.equal(g.authorize("search", SEARCH).ok, false, "nothing runs after a stop");
  });

  it("makes calls running at the same time fit together, not one at a time", () => {
    const g = new Governor({ ceilingUsd: 0.2, wrapUpUsd: 0.2 });
    const granted = [1, 2, 3, 4, 5, 6].map(() => g.authorize("search", SEARCH)).filter((a) => a.ok);
    assert.ok(granted.length < 6, "some parallel searches are refused");
    assert.ok(g.committedUsd() <= 0.2 + 1e-9);
  });

  it("charges a call with no readable bill its full worst case", () => {
    const g = new Governor();
    const auth = g.authorize("evaluate", EVALUATE);
    assert.ok(auth.ok);
    g.settle(auth.ticket, null);
    assert.equal(g.spentUsd(), auth.holdUsd);
    assert.equal(g.snapshot().uncertainCalls, 1);
  });

  it("frees a hold (and the count) for a call that was never sent", () => {
    const g = new Governor();
    const auth = g.authorize("search", SEARCH);
    assert.ok(auth.ok);
    g.release(auth.ticket);
    assert.equal(g.committedUsd(), 0);
    assert.equal(g.count("search"), 0);
  });

  it("stops the run if a bill comes in above the ceiling (e.g., an unexpected model)", () => {
    const g = new Governor({ ceilingUsd: 0.1, wrapUpUsd: 0.08 });
    const auth = g.authorize("agent-turn", { inputTokens: 1_000, maxOutputTokens: 2_000 });
    assert.ok(auth.ok);
    g.settle(auth.ticket, { model: "claude-mystery", usage: { inputTokens: 5_000, outputTokens: 2_000 } });
    assert.equal(g.stopped(), "budget");
    assert.equal(g.snapshot().overrun, true);
  });
});

describe("governor: stages and limits", () => {
  it("moves to wrap-up at the spending mark, and closes research", () => {
    const g = new Governor({ wrapUpUsd: 0.05 });
    const a = g.authorize("evaluate", EVALUATE);
    assert.ok(a.ok);
    g.settle(a.ticket, { model: MODEL, usage: { inputTokens: 8_000, outputTokens: 5_000 } });
    assert.equal(g.stage(), "wrap-up");
    assert.equal(g.wrapUpReason(), "budget");
    const search = g.authorize("search", SEARCH);
    assert.equal(search.ok, false);
    if (!search.ok) assert.match(search.reason, /Research is closed/);
    assert.ok(g.authorize("rescore", { inputTokens: 4_000, maxOutputTokens: 5_000 }).ok, "finishing work still runs");
  });

  it("wraps up at 200 seconds and stops when no call fits in the time left", () => {
    const c = clock();
    const g = new Governor({}, c.now);
    c.advance(AGENT_LIMITS.wrapUpMs);
    assert.equal(g.stage(), "wrap-up");
    assert.equal(g.wrapUpReason(), "time");
    c.advance(AGENT_LIMITS.wallClockMs - AGENT_LIMITS.wrapUpMs - AGENT_LIMITS.minCallMs + 1);
    assert.equal(g.stage(), "stopped");
    assert.equal(g.stopped(), "time");
    const turn = g.authorize("agent-turn", TURN);
    assert.equal(turn.ok, false);
  });

  it("wraps up at turn 18 and ends at turn 24", () => {
    const g = new Governor({ ceilingUsd: 100, wrapUpUsd: 100 });
    for (let i = 0; i < AGENT_LIMITS.wrapUpTurn; i++) {
      const a = g.authorize("agent-turn", TURN);
      assert.ok(a.ok);
      g.settle(a.ticket, { model: MODEL, usage: { inputTokens: 100, outputTokens: 100 } });
    }
    assert.equal(g.wrapUpReason(), "turns");
    for (let i = AGENT_LIMITS.wrapUpTurn; i < AGENT_LIMITS.maxTurns; i++) {
      const a = g.authorize("agent-turn", TURN);
      assert.ok(a.ok);
      g.settle(a.ticket, { model: MODEL, usage: { inputTokens: 100, outputTokens: 100 } });
    }
    const last = g.authorize("agent-turn", TURN);
    assert.equal(last.ok, false);
    assert.equal(g.stopped(), "turns");
  });

  it("wraps up when the agent's working context gets long", () => {
    const g = new Governor();
    const a = g.authorize("agent-turn", TURN);
    assert.ok(a.ok);
    g.settle(a.ticket, { model: MODEL, usage: { inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 59_000 } });
    assert.equal(g.wrapUpReason(), "context");
  });

  it("enforces per-kind limits without ending the run", () => {
    const g = new Governor({ ceilingUsd: 100, wrapUpUsd: 100 });
    const tryKind = (kind: PaidCallKind, plan: CallPlan, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = g.authorize(kind, plan);
        assert.ok(a.ok, `${kind} #${i + 1}`);
        g.settle(a.ticket, { model: MODEL, usage: { inputTokens: 10, outputTokens: 10 } });
      }
      const over = g.authorize(kind, plan);
      assert.equal(over.ok, false);
      if (!over.ok) assert.equal(over.ends, false);
    };
    tryKind("search", SEARCH, AGENT_LIMITS.maxSearches);
    tryKind("read", SEARCH, AGENT_LIMITS.maxReads);
    tryKind("evaluate", EVALUATE, AGENT_LIMITS.maxEvaluations);
    tryKind("rescore", EVALUATE, AGENT_LIMITS.maxRescores);
    assert.equal(g.stopped(), null);
  });

  it("ends the run at the tool-call limit", () => {
    const g = new Governor({ maxToolCalls: 3 });
    assert.ok(g.countToolCall().ok);
    assert.ok(g.countToolCall().ok);
    assert.ok(g.countToolCall().ok);
    const fourth = g.countToolCall();
    assert.equal(fourth.ok, false);
    assert.equal(g.stopped(), "tool-calls");
  });

  it("ends the run after three badly formed tool calls in a row, but not if they're interrupted", () => {
    const g = new Governor();
    assert.equal(g.recordToolInput(false), false);
    assert.equal(g.recordToolInput(false), false);
    assert.equal(g.recordToolInput(true), false, "a good call resets the streak");
    assert.equal(g.recordToolInput(false), false);
    assert.equal(g.recordToolInput(false), false);
    assert.equal(g.recordToolInput(false), true);
    assert.equal(g.stopped(), "malformed");
  });

  it("keeps the first stop reason", () => {
    const g = new Governor();
    g.halt("canceled");
    g.halt("budget");
    assert.equal(g.stopped(), "canceled");
  });
});

describe("governor: the ceiling holds under random runs", () => {
  /** Small seeded random generator, so a failure can be reproduced. */
  function rng(seed: number) {
    return () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
      return seed / 2 ** 32;
    };
  }
  const kinds: PaidCallKind[] = ["agent-turn", "search", "read", "evaluate", "rescore"];

  it("never lets estimated spend pass $0.75 when bills stay within the worst case", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const g = new Governor();
      const open: { ticket: number; plan: CallPlan; max: number }[] = [];
      for (let step = 0; step < 80 && !g.stopped(); step++) {
        // Sometimes start a call (several may run at once), sometimes finish one.
        if (open.length === 0 || r() < 0.6) {
          const kind = kinds[Math.floor(r() * kinds.length)];
          const plan: CallPlan = {
            inputTokens: Math.floor(r() * 40_000),
            maxOutputTokens: 1_000 + Math.floor(r() * 10_000),
            maxSearches: kind === "search" ? 1 : 0,
            serverAddedTokens: kind === "search" || kind === "read" ? Math.floor(r() * 25_000) : 0,
          };
          const a = g.authorize(kind, plan);
          if (a.ok) open.push({ ticket: a.ticket, plan, max: a.maxOutputTokens });
        } else {
          const i = Math.floor(r() * open.length);
          const [call] = open.splice(i, 1);
          if (r() < 0.05) {
            g.settle(call.ticket, null); // no readable bill
          } else {
            // A real bill is at most the worst case: input split between fresh, cache write and cache read.
            const input = Math.floor(call.plan.inputTokens * r());
            const write = Math.floor((call.plan.inputTokens - input) * r());
            const read = call.plan.inputTokens - input - write;
            g.settle(call.ticket, {
              model: MODEL,
              usage: {
                inputTokens: input + Math.floor((call.plan.serverAddedTokens ?? 0) * r()),
                cacheWriteTokens: write,
                cacheReadTokens: read,
                outputTokens: Math.floor(call.max * r()),
                webSearches: call.plan.maxSearches ?? 0,
              },
            });
          }
        }
        assert.ok(g.committedUsd() <= AGENT_LIMITS.ceilingUsd + 1e-9, `seed ${seed}: committed $${g.committedUsd()}`);
      }
      for (const call of open) g.settle(call.ticket, null);
      assert.ok(g.spentUsd() <= AGENT_LIMITS.ceilingUsd + 1e-9, `seed ${seed}: spent $${g.spentUsd()}`);
      assert.equal(g.snapshot().overrun, false);
    }
  });
});
