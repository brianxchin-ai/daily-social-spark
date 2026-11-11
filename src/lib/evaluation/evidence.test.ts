import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRegister, checkLedger, type LedgerDraft } from "../research/ledger.ts";
import { checkGrounding, evidenceResult, revisedEvidence } from "./evidence.ts";
import {
  combineFit,
  decideRevision,
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type CriterionResult,
} from "./scoring.ts";

/* ---------- Fixtures ---------- */

const NOW = new Date("2026-11-11T12:00:00Z");

/** A ledger with G1 eligible for both criteria and G2 with presence evidence only. */
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

const concept = (remix: number, comp: number, audio: number, fit: number, cross: number): CriterionResult[] => [
  { criterionId: "remixability", status: "scored", score: remix, rationale: "r" },
  { criterionId: "comprehension", status: "scored", score: comp, rationale: "r" },
  { criterionId: "audioPortability", status: "scored", score: audio, rationale: "r" },
  { criterionId: "brandPlatformFit", status: "scored", score: fit, rationale: "r" },
  { criterionId: "crossPlatform", status: "scored", score: cross, rationale: "r" },
];
const evidence = (cr: number | null, em: number | null): CriterionResult[] => [
  { criterionId: "culturalRelevance", status: cr === null ? "unverified" : "scored", score: cr, rationale: "r" },
  { criterionId: "emergingMomentum", status: em === null ? "unverified" : "scored", score: em, rationale: "r" },
];
const input = (id: string, i: number, results: CriterionResult[]): CandidateInput => ({
  candidateId: id,
  generationIndex: i,
  results,
  audioRole: "no-audio",
  meaningfulAudioVariations: 0,
});

/* ---------- Acceptance 1: unconventional but excellent beats obvious but mediocre ---------- */

test("acceptance 1: an unconventional, excellent brand adaptation outranks an obvious, mediocre one", () => {
  // The evaluator is told to reward compelling surprise and not to reward obviousness;
  // given those judgments, code ranks the unconventional idea first.
  const unconventional = [...evidence(null, null), ...concept(5, 4, 5, 5, 4)];
  const obvious = [...evidence(null, null), ...concept(3, 5, 5, 3, 3)];
  const r = rankCandidates([input("obvious", 0, obvious), input("unconventional", 1, unconventional)]);
  assert.equal(r.leaderId, "unconventional");
});

test("acceptance 1b: excellent brand fit can't hide poor platform fit (the criterion takes the lower part)", () => {
  const fit = combineFit({ score: 5, rationale: "Great brand idea." }, { score: 1, rationale: "Generic video." });
  assert.equal(fit.score, 1);
  assert.deepEqual(fit.parts, { brand: 5, platform: 1 });
  const results = [...evidence(null, null), ...concept(5, 5, 5, 5, 5).filter((r) => r.criterionId !== "brandPlatformFit"), fit];
  const s = scoreCandidate(input("x", 0, results));
  assert.equal(s.rejected, true);
  assert.equal(s.rejectionReasons[0].code, "fit-fails");
});

/* ---------- Acceptance 3 and 4: placeholders, provisional labels ---------- */

test("acceptance 3: an unverified but creatively strong idea outranks a weak, heavily documented one", () => {
  const strong = [...evidence(null, null), ...concept(5, 5, 5, 5, 5)]; // concept 100, ranking (3,3 placeholders)
  const weakDocumented = [...evidence(4, 4), ...concept(2, 3, 3, 3, 2)];
  const r = rankCandidates([input("documented", 0, weakDocumented), input("strong", 1, strong)]);
  const s = r.scores.find((x) => x.candidateId === "strong")!;
  const d = r.scores.find((x) => x.candidateId === "documented")!;
  assert.equal(r.leaderId, "strong");
  assert.equal(s.rankingScore, 75); // (25×3 + 25×3 + 50×5) → avg 4 → 75
  assert.equal(s.provisional, true);
  assert.deepEqual(s.placeholders, ["culturalRelevance", "emergingMomentum"]);
  assert.equal(s.status, "unverified-hypothesis");
  assert.equal(d.provisional, false);
  assert.equal(d.status, "evidence-backed");
});

test("acceptance 4: the placeholder changes which candidate wins, and the provisional score stays explicit", () => {
  // A: strong concept, no evidence. B: weaker concept, verified evidence at 5.
  const a = [...evidence(null, null), ...concept(5, 5, 5, 4, 2)]; // concept 87.5
  const b = [...evidence(5, 5), ...concept(4, 4, 4, 4, 2)]; // concept 70
  const sa = scoreCandidate(input("A", 0, a));
  const sb = scoreCandidate(input("B", 1, b));
  // Scored criteria only (no placeholder), A would lead: 87.5 vs 85.
  assert.equal(sa.applicableScore, 87.5);
  assert.equal(sb.applicableScore, 85);
  // With the neutral placeholder for A's unverified criteria, B leads: 85 vs 68.75.
  assert.equal(sa.rankingScore, 68.75);
  assert.equal(sb.rankingScore, 85);
  const r = rankCandidates([input("A", 0, a), input("B", 1, b)]);
  assert.equal(r.leaderId, "B");
  assert.equal(r.scores.find((x) => x.candidateId === "A")!.provisional, true);
  // Concept Score is still reported separately and unchanged by placeholders.
  assert.equal(sa.conceptScore, 87.5);
  assert.equal(sb.conceptScore, 70);
});

test("partial evidence: one verified criterion → partially evidenced, still provisional", () => {
  const s = scoreCandidate(input("p", 0, [...evidence(4, null), ...concept(4, 4, 4, 4, 4)]));
  assert.equal(s.status, "partially-evidenced");
  assert.equal(s.provisional, true);
  assert.deepEqual(s.placeholders, ["emergingMomentum"]);
});

test("without any evidence, ranking order equals Concept Score order (Day 2 behavior preserved)", () => {
  const xs = [concept(4, 3, 5, 4, 3), concept(5, 4, 5, 4, 4), concept(3, 3, 3, 3, 3)].map((c, i) =>
    input(`c${i}`, i, [...evidence(null, null), ...c]),
  );
  const byRanking = rankCandidates(xs).scores.map((s) => s.candidateId);
  const byConcept = xs.map(scoreCandidate).sort((p, q) => q.conceptScore - p.conceptScore).map((s) => s.candidateId);
  assert.deepEqual(byRanking, byConcept);
});

/* ---------- Evidence rules (acceptance 5 and the specific-claim rule) ---------- */

const ledger = makeLedger();
const G1 = ledger.signals[0];
const G2 = ledger.signals[1];
const obsIds = (signalId: string) => ledger.observations.filter((o) => o.signalId === signalId).map((o) => o.id);

test("evidence: a grounded, eligible, cited score stands, capped by the evidence", () => {
  assert.equal(G1.momentum.status, "eligible");
  const em = evidenceResult("emergingMomentum", { proposedScore: 5, observationIds: obsIds(G1.id), rationale: "Doubling reported." }, ledger, [G1.id]);
  assert.equal(em.status, "scored");
  assert.equal(em.score, 4); // one dated increase + support → capped at 4
  assert.match(em.rationale, /capped at 4/);
  const cr = evidenceResult("culturalRelevance", { proposedScore: 4, observationIds: obsIds(G1.id), rationale: "Live behavior." }, ledger, [G1.id]);
  assert.equal(cr.score, 4);
});

test("acceptance 5: a momentum claim without valid growth evidence stays unverified", () => {
  // G2 has presence evidence and a growth claim dated only by publication.
  assert.equal(G2.momentum.status, "unverified");
  const em = evidenceResult(
    "emergingMomentum",
    { proposedScore: 5, observationIds: obsIds(G2.id), rationale: "Searches skyrocketed and it's new." },
    ledger,
    [G2.id],
  );
  assert.equal(em.status, "unverified");
  assert.equal(em.score, null);
});

test("acceptance 5b: even on an eligible signal, citing only presence observations doesn't verify momentum", () => {
  const presenceOnly = ledger.observations.filter((o) => o.signalId === G1.id && o.kind === "presence").map((o) => o.id);
  const em = evidenceResult("emergingMomentum", { proposedScore: 4, observationIds: presenceOnly, rationale: "Recent and popular." }, ledger, [G1.id]);
  assert.equal(em.status, "unverified");
  assert.match(em.rationale, /behavior-dated increase/);
});

test("evidence must belong to this idea's own signals, not a loosely related one", () => {
  const cr = evidenceResult("culturalRelevance", { proposedScore: 4, observationIds: obsIds(G1.id), rationale: "x" }, ledger, [G2.id]);
  assert.equal(cr.status, "unverified");
});

test("a proposal of 0, or no grounding, stays unverified", () => {
  assert.equal(evidenceResult("culturalRelevance", { proposedScore: 0, observationIds: [], rationale: "Needs dated sources." }, ledger, [G1.id]).status, "unverified");
  assert.equal(evidenceResult("culturalRelevance", { proposedScore: 4, observationIds: obsIds(G1.id), rationale: "x" }, ledger, []).status, "unverified");
});

/* ---------- Acceptance 6 and 7: revision integrity ---------- */

test("acceptance 6: a revision that breaks its evidence grounding is rejected, even with a big concept gain", () => {
  const originalResults = [...evidence(4, 4), ...concept(3, 3, 3, 3, 3)];
  const carried = revisedEvidence(originalResults, { culturalRelevance: "no", emergingMomentum: "yes" }, false);
  assert.equal(carried[0].status, "unverified");
  assert.equal(carried[1].status, "scored");
  const changed = revisedEvidence(originalResults, { culturalRelevance: "yes", emergingMomentum: "yes" }, true);
  assert.ok(changed.every((r) => r.status === "unverified"));

  const original = scoreCandidate(input("o", 0, originalResults));
  const revised = scoreCandidate(input("r", 1, [...carried, ...concept(5, 5, 5, 5, 5)]));
  const d = decideRevision(original, revised, { preservesMechanic: true, addressesWeakness: true, noUnsupportedClaims: true }, { lostVerified: ["culturalRelevance"] });
  assert.equal(d.gain, 50);
  assert.equal(d.outcome, "kept-original");
  assert.ok(d.checks.some((c) => !c.passed && c.rule.startsWith("Keeps every verified evidence criterion")));
});

test("acceptance 7: a revision under the 5-point Concept Score gain is rejected, even if its ranking score rises", () => {
  const original = scoreCandidate(input("o", 0, [...evidence(null, null), ...concept(4, 4, 4, 4, 4)])); // concept 75
  const revised = scoreCandidate(input("r", 1, [...evidence(null, null), ...concept(4, 5, 4, 4, 4)])); // concept 80? check below
  const smaller = scoreCandidate(input("s", 1, [...evidence(null, null), ...concept(4, 4, 4, 4, 5)])); // +2.5
  const ok = { preservesMechanic: true, addressesWeakness: true, noUnsupportedClaims: true };
  assert.equal(decideRevision(original, smaller, ok, { lostVerified: [] }).outcome, "kept-original");
  assert.equal(decideRevision(original, smaller, ok, { lostVerified: [] }).gain, 2.5);
  assert.equal(decideRevision(original, revised, ok, { lostVerified: [] }).outcome, "kept-revised");
});

/* ---------- Acceptance 8: no ledger, no verified research ---------- */

test("acceptance 8: without a verified ledger, nothing is scored as evidence and no grounding is kept", () => {
  const cr = evidenceResult("culturalRelevance", { proposedScore: 5, observationIds: ["O1"], rationale: "x" }, null, ["G1"]);
  assert.equal(cr.status, "unverified");
  assert.match(cr.rationale, /No verified research/);
  const g = checkGrounding({ groundedIn: ["G1"], evidenceBasis: "x" }, null);
  assert.deepEqual(g.groundedIn, []);
  assert.equal(g.warnings.length, 1);
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

/* ---------- CP2 refinements: context vs. direct evidence, fair competition ---------- */

test("acceptance: contextual evidence doesn't verify an unrelated mechanism", () => {
  // The idea's mechanism is grounded in G2; G1 is listed only as context. Citing G1's strong evidence verifies nothing.
  const g1Obs = ledger.observations.filter((o) => o.signalId === G1.id).map((o) => o.id);
  const cr = evidenceResult("culturalRelevance", { proposedScore: 5, observationIds: g1Obs, rationale: "Context shows the category is live." }, ledger, [G2.id]);
  const em = evidenceResult("emergingMomentum", { proposedScore: 5, observationIds: g1Obs, rationale: "Context is growing." }, ledger, [G2.id]);
  assert.equal(cr.status, "unverified");
  assert.equal(em.status, "unverified");
  // A signal can't be both: direct wins, and it leaves the context list.
  const g = checkGrounding({ groundedIn: ["G1"], contextIn: ["G1", "G2"], evidenceBasis: "G1 is direct; G2 is context." }, ledger);
  assert.deepEqual(g.groundedIn, ["G1"]);
  assert.deepEqual(g.contextIn, ["G2"]);
});

test("acceptance: a strong unconventional idea competes on the same terms as a strong conventional one", () => {
  // Scoring has no input for "unconventional": equal scores tie and fall to the standard tie-breaks;
  // the better-judged execution wins either way.
  const conventional = [...evidence(null, null), ...concept(5, 5, 5, 4, 4)];
  const unconventionalEqual = [...evidence(null, null), ...concept(5, 5, 5, 4, 4)];
  const tie = rankCandidates([input("conventional", 0, conventional), input("unconventional", 1, unconventionalEqual)]);
  assert.equal(tie.scores[0].rankingScore, tie.scores[1].rankingScore);
  assert.equal(tie.leaderId, "conventional"); // generation order, not novelty, breaks the exact tie

  const unconventionalStronger = [...evidence(null, null), ...concept(5, 5, 5, 5, 4)];
  assert.equal(rankCandidates([input("conventional", 0, conventional), input("unconventional", 1, unconventionalStronger)]).leaderId, "unconventional");
  const unconventionalWeaker = [...evidence(null, null), ...concept(4, 5, 5, 4, 4)];
  assert.equal(rankCandidates([input("conventional", 0, conventional), input("unconventional", 1, unconventionalWeaker)]).leaderId, "conventional");
});

test("regression: an idea grounded in a signal with no validated observations is kept, but warned as not direct evidence", () => {
  const empty = { ...G1, id: "G3", name: "Tiny-text reveal", observationIds: [] };
  const withEmpty = { ...ledger, signals: [...ledger.signals, empty] };
  const g = checkGrounding({ groundedIn: ["G3"], evidenceBasis: "G3 is direct evidence of the mechanism." }, withEmpty);
  assert.deepEqual(g.groundedIn, ["G3"]); // the idea and its inspiration are preserved
  assert.ok(g.warnings.some((w) => w.startsWith('G3 ("Tiny-text reveal") has no validated observations')));
  // …and nothing can be verified from it.
  const cr = evidenceResult("culturalRelevance", { proposedScore: 4, observationIds: [], rationale: "x" }, withEmpty, ["G3"]);
  assert.equal(cr.status, "unverified");
  // A grounded signal that does have observations gets no such warning.
  assert.ok(!checkGrounding({ groundedIn: ["G1"], evidenceBasis: "G1 shows it." }, ledger).warnings.some((w) => w.includes("no validated observations")));
});

/* ---------- Checkpoint 3: tie explanations (display only) ---------- */

test("ties: the live-test case (both 65) reports the comprehension tie-break, without changing the ranking", async () => {
  const { explainTies } = await import("./scoring.ts");
  const tiny = [...evidence(null, null), ...concept(4, 4, 5, 4, 4)]; // concept 80 → ranking 65
  const hallelujah = [...evidence(null, null), ...concept(4, 5, 4, 4, 4)]; // concept 80 → ranking 65
  const deadpan = [...evidence(null, null), ...concept(4, 3, 4, 4, 3)];
  const inputs = [input("tiny", 0, tiny), input("hallelujah", 1, hallelujah), input("deadpan", 2, deadpan)];
  const r = rankCandidates(inputs);
  assert.equal(r.leaderId, "hallelujah");
  const ties = explainTies(r.scores, new Map(inputs.map((i) => [i.candidateId, i.results])));
  assert.equal(ties.length, 1);
  assert.equal(ties[0].ahead, "hallelujah");
  assert.equal(ties[0].behind, "tiny");
  assert.equal(ties[0].score, 65);
  assert.deepEqual(ties[0].decidedBy, { criterionId: "comprehension", ahead: 5, behind: 4 });
});

test("ties: identical scores on every tie-break fall to generation order; distinct scores report no tie", async () => {
  const { explainTies } = await import("./scoring.ts");
  const same = [...evidence(null, null), ...concept(4, 4, 4, 4, 4)];
  const inputs = [input("first", 0, same), input("second", 1, same)];
  const r = rankCandidates(inputs);
  const ties = explainTies(r.scores, new Map(inputs.map((i) => [i.candidateId, i.results])));
  assert.equal(ties[0].decidedBy, "generation-order");
  const distinct = [input("a", 0, same), input("b", 1, [...evidence(null, null), ...concept(5, 4, 4, 4, 4)])];
  assert.deepEqual(explainTies(rankCandidates(distinct).scores, new Map(distinct.map((i) => [i.candidateId, i.results]))), []);
});
