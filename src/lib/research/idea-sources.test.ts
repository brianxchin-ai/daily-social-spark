import assert from "node:assert/strict";
import { test } from "node:test";
import { headlineKey, isSocialDomain, safeHttpUrl, sourcesForIdea } from "./idea-sources.ts";
import type { EvidenceLedger } from "./ledger.ts";

/** Just enough of a ledger for the link lookup: signals → observations → sources. */
function ledger(): EvidenceLedger {
  const source = (id: string, url: string, domain: string, setAside = false) => ({
    id, url, domain, title: `Title ${id}`, pageUpdated: "Nov 10, 2026", query: "q", setAside,
  });
  const obs = (id: string, signalId: string, sourceIds: string[]) => ({ id, signalId, sourceIds });
  const signal = (id: string, observationIds: string[]) => ({ id, observationIds });
  return {
    sources: [
      source("S1", "https://news.example.com/a", "news.example.com"),
      source("S2", "https://www.tiktok.com/@creator/video/1", "www.tiktok.com"),
      source("S3", "https://blog.example.com/b", "blog.example.com", true),
      source("S4", "javascript:alert(1)", "evil.example.com"),
      source("S5", "https://context.example.com/c", "context.example.com"),
    ],
    observations: [obs("O1", "G1", ["S1", "S2"]), obs("O2", "G1", ["S2", "S3", "S4"]), obs("O3", "G2", ["S5", "S1"])],
    signals: [signal("G1", ["O1", "O2"]), signal("G2", ["O3"]), signal("G3", [])],
  } as unknown as EvidenceLedger;
}

test("idea sources: only real ledger links, reached through the idea's own signals", () => {
  const out = sourcesForIdea({ groundedIn: ["G1"], contextIn: ["G2"] }, ledger());
  assert.deepEqual(
    out.map((s) => [s.id, s.role, s.kind]),
    [
      ["S1", "direct", "article"],
      ["S2", "direct", "social"],
      ["S5", "context", "article"],
    ],
  );
  // Set-aside sources and non-web URLs are never shown; each source appears once.
  assert.ok(!out.some((s) => s.id === "S3" || s.id === "S4"));
  for (const s of out) assert.ok(ledger().sources.some((x) => x.url === s.url), "URL must come from the ledger");
});

test("idea sources: no ledger, unknown signals or an ungrounded idea give no links", () => {
  assert.deepEqual(sourcesForIdea({ groundedIn: ["G1"], contextIn: [] }, null), []);
  assert.deepEqual(sourcesForIdea({ groundedIn: ["G9"], contextIn: [] }, ledger()), []);
  assert.deepEqual(sourcesForIdea({ groundedIn: [], contextIn: [] }, ledger()), []);
  assert.deepEqual(sourcesForIdea({ groundedIn: ["G3"], contextIn: [] }, ledger()), []);
});

test("idea sources: a limit caps the list", () => {
  assert.equal(sourcesForIdea({ groundedIn: ["G1"], contextIn: ["G2"] }, ledger(), 2).length, 2);
});

test("idea sources: social domains and safe URLs", () => {
  for (const d of ["tiktok.com", "www.tiktok.com", "m.youtube.com", "instagram.com", "x.com"]) assert.ok(isSocialDomain(d), d);
  for (const d of ["example.com", "tiktok.com.evil.net", "box.com", "nottiktok.com"]) assert.ok(!isSocialDomain(d), d);
  assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(safeHttpUrl("not a url"), null);
  assert.equal(safeHttpUrl("https://example.com/x"), "https://example.com/x");
});

test("idea sources: the same story syndicated under different addresses appears once", () => {
  const t = "What's The 'I Got So Mad' Meme? The Viral Trend About Absurd Ways To Express Anger Explained";
  const source = (id: string, url: string, title: string) => ({
    id, url, domain: new URL(url).hostname, title, pageUpdated: null, query: "q", setAside: false,
  });
  const ledger = {
    sources: [
      source("S1", "https://knowyourmeme.com/memes/i-got-so-mad", "I Got So Mad Trend / Meme"),
      source("S2", "https://sg.news.yahoo.com/a", `${t} - Yahoo News Singapore`),
      source("S3", "https://www.yahoo.com/b", t),
      source("S4", "https://trending.knowyourmeme.com/c", "What's The 'I Got So Mad' Meme? The Viral Trend About Absurd Ways To Express Ang..."),
      source("S5", "https://meme.example.com/d", "I Got So Mad Trend: The 2026 TikTok Anger Format"),
    ],
    observations: [{ id: "O1", signalId: "G1", sourceIds: ["S1", "S2", "S3", "S4", "S5"] }],
    signals: [{ id: "G1", observationIds: ["O1"] }],
  } as unknown as EvidenceLedger;
  const out = sourcesForIdea({ groundedIn: ["G1"], contextIn: [] }, ledger);
  assert.deepEqual(out.map((s) => s.id), ["S1", "S2", "S5"]);
  assert.equal(headlineKey(`${t} - Yahoo News Singapore`), headlineKey(t));
  // Different stories with a shared opening aren't merged when the shared part is short.
  assert.notEqual(headlineKey("I Got So Mad Trend / Meme"), headlineKey("I Got So Mad Trend: The 2026 TikTok Anger Format"));
});
