import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvidenceLedger } from "./ledger.ts";
import { LEDGER_TTL_MS, signLedger, verifyLedger } from "./signing.ts";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-11-11T12:00:00Z");
const binding = { brand: "Glossier", platform: "tiktok" as const };

const ledger = {
  version: 1,
  brand: "Glossier",
  platform: "tiktok",
  createdAt: NOW.toISOString(),
  queries: ["q"],
  searchErrors: [],
  sources: [{ id: "S1", url: "https://a.com", domain: "a.com", title: "A", pageUpdated: null, query: "q", setAside: false }],
  citations: [{ id: "C1", sourceId: "S1", quote: "Real quote." }],
  signals: [],
  observations: [],
  inferences: [],
  gaps: [],
  adjustments: [],
  discovery: { searches: 1, brandFreeSearches: 1 },
} satisfies EvidenceLedger;

const later = (ms: number) => new Date(NOW.getTime() + ms);

test("a signed ledger verifies for the same brand and platform", () => {
  const { token, expiresAt } = signLedger(ledger, binding, SECRET, NOW);
  const r = verifyLedger(token, { brand: "  glossier ", platform: "tiktok" }, SECRET, later(60_000));
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.ledger.citations[0].quote, "Real quote.");
  assert.equal(expiresAt, later(LEDGER_TTL_MS).toISOString());
});

test("an altered ledger is rejected", () => {
  const { token } = signLedger(ledger, binding, SECRET, NOW);
  const [body, sig] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.ledger.citations[0].quote = "Something the source never said.";
  const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
  assert.deepEqual(pick(verifyLedger(forged, binding, SECRET, NOW)), "altered");
});

test("a tampered signature or a different secret is rejected", () => {
  const { token } = signLedger(ledger, binding, SECRET, NOW);
  const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  assert.equal(pick(verifyLedger(flipped, binding, SECRET, NOW)), "altered");
  assert.equal(pick(verifyLedger(token, binding, "another-secret-0123456789-abcdefghij", NOW)), "altered");
});

test("an expired ledger is rejected", () => {
  const { token } = signLedger(ledger, binding, SECRET, NOW);
  assert.equal(pick(verifyLedger(token, binding, SECRET, later(LEDGER_TTL_MS + 1))), "expired");
});

test("a ledger for a different brand or platform is rejected", () => {
  const { token } = signLedger(ledger, binding, SECRET, NOW);
  assert.equal(pick(verifyLedger(token, { brand: "Fenty Beauty", platform: "tiktok" }, SECRET, NOW)), "mismatch");
  assert.equal(pick(verifyLedger(token, { brand: "Glossier", platform: "youtube-shorts" }, SECRET, NOW)), "mismatch");
});

test("malformed handoffs are rejected", () => {
  for (const bad of [undefined, "", "abc", "a.b.c", 42]) assert.notEqual(verifyLedger(bad, binding, SECRET, NOW).ok, true);
});

test("signing refuses a missing or short secret", () => {
  assert.throws(() => signLedger(ledger, binding, "short", NOW));
  assert.throws(() => verifyLedger("a.b", binding, "", NOW));
});

function pick(r: ReturnType<typeof verifyLedger>) {
  return r.ok ? "ok" : r.reason;
}
