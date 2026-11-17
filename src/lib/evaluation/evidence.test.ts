import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRegister, checkLedger, freshnessPhrase, pageAgeDate, signalFreshness, type LedgerDraft, type LedgerObservation, type SourceRecord } from "../research/ledger.ts";
import { checkGrounding, freshestSignal, ideaKind, relevanceResult } from "./evidence.ts";
import {
  combineFit,
  explainTies,
  rankCandidates,
  type CandidateInput,
  type CriterionResult,
} from "./scoring.ts";

/* ---------- Fixtures ---------- */

const NOW = new Date("2026-11-11T12:00:00Z");

/** A ledger with two signals, both with dated presence from independent origins. */
function makeLedger() {
  const sources = [
    { url: "https://trade.com/a", quote: "Reverse-reveal makeup videos doubled between October and November 6, 2026." },
    { url: "https://news.com/b", quote: "On November 2, 2026, creators were filmed showing the finished look first." },
    { url: "https://culture.com/c", quote: "A columnist noted on November 4, 2026 that reverse reveals keep appearing." },
    { url: "https://slang.com/d", quote: "On November 3, 2026, commenters started replying with timestamps." },
    { url: "https://forum.com/e", quote: "Users began replying with timestamps on November 5, 2026, one forum noted." },
    { url: "https://blog.com/f", quote: "Searches for timestamp replies have skyrocketed. Published November 9, 2026." },
  ];
  const register = buildRegister(
    [{ query: "q", results: sources.map((s) => ({ url: s.url, title: "t", pageAge: null })), errorCode: null }],
    sources.map((s) => ({ url: s.url, citedText: s.quote })),
  );
  const o = (c: string, extra: Partial<LedgerDraft["signals"][number]["observations"][number]> = {}) => ({
    statement: "s",
    kind: "presence" as const,
    citationIds: [c],
    dateText: "",
    dateBasis: "none" as const,
    attributedTo: "",
    ...extra,
  });
  const sig = (name: string, observations: ReturnType<typeof o>[]) => ({
    name,
    category: "creator-behavior" as const,
    categoryRelation: "in-category" as const,
    summary: "s",
    lineage: "None identified",
    novelty: "uncertain" as const,
    whatIsNew: "",
    lookback: "Not checked",
    lineageQuery: "",
    creativeOpportunity: "",
    audienceNote: "Not documented",
    observations,
    inferences: [],
  });
  const draft: LedgerDraft = {
    signals: [
      sig("Reverse reveals", [
        o("C1", { kind: "growth", statement: "Reverse-reveal makeup videos doubled.", dateText: "November 6, 2026", dateBasis: "behavior" }),
        o("C2", { dateText: "November 2, 2026", dateBasis: "behavior" }),
        o("C3", { dateText: "November 4, 2026", dateBasis: "behavior" }),
      ]),
      sig("Reply-by-timestamp", [
        o("C4", { dateText: "November 3, 2026", dateBasis: "behavior" }),
        o("C5", { dateText: "November 5, 2026", dateBasis: "behavior" }),
        // A growth claim dated only by publication: never acceleration.
        o("C6", { kind: "growth", statement: "Searches for timestamp replies have skyrocketed.", dateText: "November 9, 2026", dateBasis: "published" }),
      ]),
    ],
    gaps: [],
    categoryTerms: [],
    searchPurposes: [],
  };
  return checkLedger({ brand: "Glossier", platform: "tiktok", now: NOW, draft, register });
}

const ledger = makeLedger();
const [G1, G2] = ledger.signals;

/** All six criteria; relevance is the reviewer's judgment. */
const results = (
  cr: number,
  stop: number,
  share: number,
  watch: number,
  part: number,
  fit: number,
  verified = false,
): CriterionResult[] => [
  { criterionId: "culturalRelevance", status: "scored", score: cr, rationale: "r", verified, judgedFrom: "both" },
  { criterionId: "stopPower", status: "scored", score: stop, rationale: "r" },
  { criterionId: "shareability", status: "scored", score: share, rationale: "r" },
  { criterionId: "watchThrough", status: "scored", score: watch, rationale: "r" },
  { criterionId: "participation", status: "scored", score: part, rationale: "r" },
  { criterionId: "brandPlatformFit", status: "scored", score: fit, rationale: "r" },
];
const input = (id: string, i: number, r: CriterionResult[]): CandidateInput => ({
  candidateId: id,
  generationIndex: i,
  results: r,
  audioRole: "no-audio",
  meaningfulAudioVariations: 0,
  kind: "fresh-trend",
  makeable: true,
});
const obsOf = (signalId: string) => ledger.observations.filter((o) => o.signalId === signalId).map((o) => o.id);

/* ---------- Cultural relevance: AI judgment, with an optional verified label ---------- */

test("relevance: the reviewer's score always stands, including a 5 with no research behind it", () => {
  const noLedger = relevanceResult({ score: 5, rationale: "Lives in campus culture.", observationIds: [], judgedFrom: "general-knowledge" }, null, []);
  assert.equal(noLedger.status, "scored");
  assert.equal(noLedger.score, 5);
  assert.equal(noLedger.verified, false);
  assert.equal(noLedger.judgedFrom, "general-knowledge");
  const ungrounded = relevanceResult({ score: 4, rationale: "x", observationIds: obsOf(G1.id), judgedFrom: "both" }, ledger, []);
  assert.equal(ungrounded.score, 4);
  assert.equal(ungrounded.verified, false);
  assert.deepEqual(ungrounded.observationIds, []); // citations outside the idea's own signals are dropped
});

test("relevance: verified only with the idea's own eligible signal and a cited, behavior-dated observation", () => {
  const v = relevanceResult({ score: 5, rationale: "x", observationIds: obsOf(G1.id), judgedFrom: "research" }, ledger, [G1.id]);
  assert.equal(v.verified, true);
  assert.equal(v.score, 5); // never capped: verification is a label
  // Grounded, but cites nothing: judgment only.
  const uncited = relevanceResult({ score: 5, rationale: "x", observationIds: [], judgedFrom: "research" }, ledger, [G1.id]);
  assert.equal(uncited.verified, false);
  assert.equal(uncited.score, 5);
  // Cites only a publication-dated observation: not verified.
  const pubOnly = ledger.observations.find((o) => o.signalId === G2.id && o.behavior.status !== "known")!;
  const pub = relevanceResult({ score: 4, rationale: "x", observationIds: [pubOnly.id], judgedFrom: "research" }, ledger, [G2.id]);
  assert.equal(pub.verified, false);
});

test("relevance: context evidence never verifies an unrelated mechanism", () => {
  // The idea's mechanism is grounded in G2; it cites G1's strong evidence, which is only context.
  const cr = relevanceResult({ score: 5, rationale: "Context shows the category is live.", observationIds: obsOf(G1.id), judgedFrom: "research" }, ledger, [G2.id]);
  assert.equal(cr.verified, false);
  assert.equal(cr.score, 5);
});

test("relevance: verification is a label; it never changes the ranking", () => {
  const verified = results(4, 4, 4, 4, 4, 4, true);
  const judged = results(4, 4, 4, 4, 4, 4, false);
  const r = rankCandidates([input("judged", 0, judged), input("verified", 1, verified)]);
  assert.equal(r.scores[0].rankingScore, r.scores[1].rankingScore);
  assert.equal(r.leaderId, "judged"); // generation order breaks the exact tie, not verification
  assert.equal(r.scores.find((x) => x.candidateId === "verified")!.relevanceVerified, true);
});

/* ---------- Fit, competition and grounding ---------- */

test("acceptance 1: an unconventional, excellent brand adaptation outranks an obvious, mediocre one", () => {
  const unconventional = results(4, 5, 5, 5, 5, 4);
  const obvious = results(4, 3, 4, 4, 3, 3);
  assert.equal(rankCandidates([input("obvious", 0, obvious), input("unconventional", 1, unconventional)]).leaderId, "unconventional");
});

test("acceptance 1b: excellent brand fit can't hide poor platform fit (the criterion takes the lower part)", () => {
  const fit = combineFit({ score: 5, rationale: "On-brand." }, { score: 2, rationale: "Not native." });
  assert.equal(fit.score, 2);
  assert.deepEqual(fit.parts, { brand: 5, platform: 2 });
});

test("a culturally sharp idea can now beat a slightly better-crafted but stale one", () => {
  const sharp = results(5, 4, 4, 4, 4, 4);
  const stale = results(2, 5, 4, 4, 4, 4);
  assert.equal(rankCandidates([input("stale", 0, stale), input("sharp", 1, sharp)]).leaderId, "sharp");
});

test("grounding: without a verified ledger, no grounding is kept", () => {
  const g = checkGrounding({ groundedIn: ["G1"], evidenceBasis: "G1." }, null);
  assert.deepEqual(g.groundedIn, []);
  assert.ok(g.warnings.length === 1);
});

test("grounding: unknown signal IDs are dropped and unquoted figures are flagged", () => {
  const g = checkGrounding({ groundedIn: ["G1", "G9"], evidenceBasis: "G1 shows a 300% rise." }, ledger);
  assert.deepEqual(g.groundedIn, ["G1"]);
  assert.ok(g.warnings.some((w) => w.includes("G9")));
  assert.ok(g.warnings.some((w) => w.includes("figure")));
});

test("grounding: ledger IDs like G1 or O3 aren't mistaken for figures", () => {
  const g = checkGrounding({ groundedIn: ["G1"], evidenceBasis: "G1 (O1, O3) shows creators posting reverse reveals." }, ledger);
  assert.deepEqual(g.warnings, []);
});

test("grounding: a signal is direct or context, never both", () => {
  const g = checkGrounding({ groundedIn: ["G1"], contextIn: ["G1", "G2"], evidenceBasis: "G1 is direct; G2 is context." }, ledger);
  assert.deepEqual(g.groundedIn, ["G1"]);
  assert.deepEqual(g.contextIn, ["G2"]);
});

test("regression: an idea grounded in a signal with no validated observations is kept, warned, and never verified", () => {
  const empty = { ...G1, id: "G3", name: "Tiny-text reveal", observationIds: [] };
  const withEmpty = { ...ledger, signals: [...ledger.signals, empty] };
  const g = checkGrounding({ groundedIn: ["G3"], evidenceBasis: "G3 is direct evidence of the mechanism." }, withEmpty);
  assert.deepEqual(g.groundedIn, ["G3"]);
  assert.ok(g.warnings.some((w) => w.startsWith('G3 ("Tiny-text reveal") has no validated observations')));
  const cr = relevanceResult({ score: 4, rationale: "x", observationIds: [], judgedFrom: "research" }, withEmpty, ["G3"]);
  assert.equal(cr.verified, false);
  assert.equal(cr.score, 4);
});

/* ---------- Tie explanations (display only) ---------- */

test("ties: unequal Spark Scores report no tie", () => {
  const a = results(4, 4, 4, 4, 5, 4); // participation 5 (10%)
  const b = results(4, 4, 4, 5, 4, 4); // watch-through 5 (15%)
  const inputs = [input("a", 0, a), input("b", 1, b)];
  const r = rankCandidates(inputs);
  // Watch-through weighs more than participation: b scores higher outright, so there's no tie to report.
  assert.equal(r.leaderId, "b");
  assert.deepEqual(explainTies(r.scores, new Map(inputs.map((i) => [i.candidateId, i.results]))), []);
});

test("ties: identical scores on every tie-break fall to generation order", () => {
  const same = results(4, 4, 4, 4, 4, 4);
  const inputs = [input("first", 0, same), input("second", 1, same)];
  const r = rankCandidates(inputs);
  const ties = explainTies(r.scores, new Map(inputs.map((i) => [i.candidateId, i.results])));
  assert.equal(r.leaderId, "first");
  assert.equal(ties[0].decidedBy, "generation-order");
});

test("ties: an exact tie reports the first tie-break criterion that differs", () => {
  // Stop power and shareability both weigh 20%: a has share 5/stop 4, b has share 4/stop 5, so the totals are equal.
  const a = results(4, 4, 5, 4, 4, 4);
  const b = results(4, 5, 4, 4, 4, 4);
  const inputs = [input("b", 0, b), input("a", 1, a)];
  const r = rankCandidates(inputs);
  assert.equal(r.leaderId, "a"); // shareability is the first tie-break
  const ties = explainTies(r.scores, new Map(inputs.map((i) => [i.candidateId, i.results])));
  assert.deepEqual(ties[0].decidedBy, { criterionId: "shareability", ahead: 5, behind: 4 });
});

/* ---------- Day 5: freshness ---------- */

test("freshness: page ages in the search API's formats become dates", () => {
  assert.equal(pageAgeDate("5 days ago", NOW), "2026-11-06");
  assert.equal(pageAgeDate("2 weeks ago", NOW), "2026-10-28");
  assert.equal(pageAgeDate("today", NOW), "2026-11-11");
  assert.equal(pageAgeDate("November 14, 2025", NOW), "2025-11-14");
  assert.equal(pageAgeDate("recently", NOW), null);
  assert.equal(pageAgeDate(null, NOW), null);
});

test("freshness: the ledger labels recent signals fresh", () => {
  assert.equal(G1.freshness.status, "fresh");
  assert.ok(G1.freshness.ageDays! <= 30);
  assert.equal(freshestSignal([G1.id, G2.id], ledger)?.freshness.status, "fresh");
});

const obs = (over: Partial<LedgerObservation>): LedgerObservation => ({
  id: "O1",
  signalId: "G1",
  statement: "s",
  kind: "presence",
  citationIds: [],
  sourceIds: ["S1"],
  behavior: { status: "unknown", reason: "none" },
  published: null,
  attributedTo: null,
  originKey: "a",
  owned: false,
  ...over,
});
const src = (pageUpdated: string | null, setAside = false): SourceRecord => ({
  id: "S1", url: "https://meme.example.com/routine", domain: "meme.example.com", title: "t", pageUpdated, query: null, setAside,
});

test("freshness: the 5.5-hour routine case (pages last updated 7–8 months ago) is stale", () => {
  const f = signalFreshness([obs({})], [src("223 days ago")], NOW);
  assert.equal(f.status, "stale");
  assert.equal(f.basis, "page-updated");
  assert.ok(f.ageDays! > 200);
});

test("freshness: behavior dates outrank page updates, so an old trend on a recently updated page stays stale", () => {
  const f = signalFreshness(
    [obs({ behavior: { status: "known", date: "2026-03-20", precision: "day", dateText: "March 20, 2026" } })],
    [src("2 days ago")],
    NOW,
  );
  assert.equal(f.status, "stale");
  assert.equal(f.basis, "behavior");
});

test("freshness: no usable date is undated; set-aside sources don't count", () => {
  assert.equal(signalFreshness([obs({})], [src(null)], NOW).status, "undated");
  assert.equal(signalFreshness([obs({})], [src("3 days ago", true)], NOW).status, "undated");
});

test("idea kind: original formats are their own kind; trend ideas need a fresh signal", () => {
  assert.equal(ideaKind({ basis: "original", groundedIn: [] }, null), "original");
  assert.equal(ideaKind({ basis: "trend", groundedIn: [G1.id] }, ledger), "fresh-trend");
  assert.equal(ideaKind({ basis: "trend", groundedIn: [] }, ledger), "stale-trend"); // a trend from memory
  assert.equal(ideaKind({ basis: "trend", groundedIn: [G1.id] }, null), "stale-trend"); // no research
  const staleLedger = { ...ledger, signals: ledger.signals.map((s) => ({ ...s, freshness: { ...s.freshness, status: "stale" as const } })) };
  assert.equal(ideaKind({ basis: "trend", groundedIn: [G1.id] }, staleLedger), "stale-trend");
});

test("grounding: an original format's signals become context, never direct evidence", () => {
  const g = checkGrounding({ basis: "original", groundedIn: ["G1"], contextIn: ["G2"], evidenceBasis: "Context only." }, ledger);
  assert.deepEqual(g.groundedIn, []);
  assert.deepEqual(g.contextIn.sort(), ["G1", "G2"]);
});

test("freshness: a page update alone counts only within 14 days; behavior and publication dates get 30", () => {
  const page20 = signalFreshness([obs({})], [src("20 days ago")], NOW);
  assert.equal(page20.status, "stale");
  assert.equal(signalFreshness([obs({})], [src("10 days ago")], NOW).status, "fresh");
  const published20 = signalFreshness(
    [obs({ published: { date: "2026-10-22", precision: "day", dateText: "October 22, 2026", sourceId: "S1", shared: false } })],
    [src(null)],
    NOW,
  );
  assert.equal(published20.status, "fresh");
  assert.equal(published20.basis, "published");
});

test("freshness: the label prefers the strongest kind of date and says which it was", () => {
  const both = signalFreshness(
    [
      obs({ id: "O1", behavior: { status: "known", date: "2026-11-01", precision: "day", dateText: "November 1, 2026" } }),
      obs({ id: "O2", sourceIds: ["S1"] }),
    ],
    [src("1 day ago")],
    NOW,
  );
  assert.equal(both.basis, "behavior"); // a 10-day-old behavior date beats a 1-day-old page update
  assert.equal(freshnessPhrase(both), "behavior dated 10 days ago");
  assert.equal(freshnessPhrase({ basis: "page-updated", ageDays: 1 }), "page updated 1 day ago");
  assert.equal(freshnessPhrase({ basis: "published", ageDays: 0 }), "reported today");
});
