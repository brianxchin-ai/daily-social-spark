import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicableScore,
  CRITERIA,
  decideRevision,
  rankCandidates,
  scoreCandidate,
  sparkScoreOf,
  type AudioRole,
  type CandidateInput,
  type CriterionResult,
  type IdeaKind,
} from "./scoring.ts";

/** All six criteria, in order: relevance, stop power, shareability, watch-through, participation, fit. */
function candidate(
  id: string,
  [cr, stop, share, watch, part, fit]: number[],
  opts: { index?: number; audioRole?: AudioRole; variations?: number; verified?: boolean; kind?: IdeaKind; makeable?: boolean } = {},
): CandidateInput {
  const scores: Record<string, number> = {
    culturalRelevance: cr,
    stopPower: stop,
    shareability: share,
    watchThrough: watch,
    participation: part,
    brandPlatformFit: fit,
  };
  const results: CriterionResult[] = CRITERIA.map((k) => ({
    criterionId: k.id,
    status: "scored",
    score: scores[k.id],
    rationale: "r",
    ...(k.id === "culturalRelevance" ? { verified: opts.verified ?? false, judgedFrom: "both" as const } : {}),
  }));
  return {
    candidateId: id,
    generationIndex: opts.index ?? 0,
    results,
    audioRole: opts.audioRole ?? "no-audio",
    meaningfulAudioVariations: opts.variations ?? 0,
    kind: opts.kind ?? "fresh-trend",
    makeable: opts.makeable ?? true,
  };
}
const all = (n: number) => [n, n, n, n, n, n];

test("reach-first rubric: six criteria, weights as approved and summing to 100%", () => {
  const weights = Object.fromEntries(CRITERIA.map((c) => [c.id, Math.round(c.weight * 100)]));
  assert.deepEqual(weights, {
    culturalRelevance: 20,
    stopPower: 20,
    shareability: 20,
    watchThrough: 15,
    participation: 10,
    brandPlatformFit: 15,
  });
  assert.equal(Object.values(weights).reduce((s, w) => s + w, 0), 100);
  for (const gone of ["emergingMomentum", "comprehension", "audioPortability", "crossPlatform", "remixability"]) {
    assert.ok(!CRITERIA.some((c) => (c.id as string) === gone), gone);
  }
});

test("worked example: 4,5,4,3,4,3 → 3.9/5 → 72.5/100", () => {
  // .20×4 + .20×5 + .20×4 + .15×3 + .10×4 + .15×3 = 3.9 → (3.9 − 1) ÷ 4 × 100
  const c = candidate("x", [4, 5, 4, 3, 4, 3]);
  assert.ok(Math.abs(sparkScoreOf(c.results) - 72.5) < 1e-9);
  assert.ok(Math.abs(applicableScore(c.results).weight - 1) < 1e-9);
  assert.ok(Math.abs(scoreCandidate(c).rankingScore - 72.5) < 1e-9);
});

test("all 5s → 100; all 1s → 0", () => {
  assert.equal(scoreCandidate(candidate("x", all(5))).rankingScore, 100);
  assert.equal(scoreCandidate(candidate("x", all(1))).rankingScore, 0);
});

test("every criterion must be scored 1–5: unscored, out-of-range, fractional or missing results are refused", () => {
  const unscored = candidate("x", all(4));
  unscored.results[0] = { criterionId: "culturalRelevance", status: "unverified", score: null, rationale: "" };
  assert.throws(() => scoreCandidate(unscored), /integer score 1–5/);
  assert.throws(() => scoreCandidate(candidate("x", [4, 6, 4, 4, 4, 4])), /integer score 1–5/);
  assert.throws(() => scoreCandidate(candidate("x", [4, 3.5, 4, 4, 4, 4])), /integer score 1–5/);
  const missing = candidate("x", all(4));
  missing.results = missing.results.filter((r) => r.criterionId !== "watchThrough");
  assert.throws(() => scoreCandidate(missing), /Missing criterion/);
});

test("rejects a Spark Score below 50; exactly 50 passes", () => {
  const low = scoreCandidate(candidate("x", [2, 3, 3, 3, 3, 3])); // 2.8 → 45
  assert.equal(low.rejected, true);
  assert.equal(low.rejectionReasons[0].code, "below-threshold");
  assert.equal(scoreCandidate(candidate("y", all(3))).rejected, false);
});

test("fit of 1 rejects, even with a high score", () => {
  const s = scoreCandidate(candidate("x", [5, 5, 5, 5, 5, 1]));
  assert.ok(s.rankingScore >= 50);
  assert.deepEqual(s.rejectionReasons.map((r) => r.code), ["fit-fails"]);
});

test("a 1 on another criterion does not reject on its own", () => {
  assert.equal(scoreCandidate(candidate("x", [5, 5, 1, 5, 5, 5])).rejected, false);
});

test("audio-led ideas need at least 3 meaningful alternatives", () => {
  const two = scoreCandidate(candidate("x", all(5), { audioRole: "audio-led", variations: 2 }));
  assert.equal(two.rejectionReasons[0].code, "audio-dependent");
  assert.equal(scoreCandidate(candidate("y", all(5), { audioRole: "audio-led", variations: 3 })).rejected, false);
  assert.equal(scoreCandidate(candidate("z", all(5), { audioRole: "audio-optional" })).rejected, false);
});

test("ranks by Spark Score, highest first; verified relevance is reported but doesn't change rank", () => {
  const r = rankCandidates([
    candidate("a", all(3), { index: 0, verified: true }),
    candidate("b", all(5), { index: 1 }),
    candidate("c", all(4), { index: 2 }),
  ]);
  assert.deepEqual(r.scores.map((s) => s.candidateId), ["b", "c", "a"]);
  assert.deepEqual(r.scores.map((s) => s.rank), [1, 2, 3]);
  assert.equal(r.leaderId, "b");
  assert.equal(r.scores.find((s) => s.candidateId === "a")!.relevanceVerified, true);
  assert.equal(r.scores.find((s) => s.candidateId === "b")!.relevanceVerified, false);
});

test("ties break on shareability first, then the rest of the agreed order, then generation order", () => {
  // Stop power and shareability both weigh 20%, so these totals are equal.
  const tie = rankCandidates([
    candidate("stop", [4, 5, 4, 4, 4, 4], { index: 0 }),
    candidate("share", [4, 4, 5, 4, 4, 4], { index: 1 }),
  ]);
  assert.equal(tie.scores[0].rankingScore, tie.scores[1].rankingScore);
  assert.equal(tie.leaderId, "share", "higher shareability wins the tie");
  const identical = rankCandidates([
    candidate("second", all(4), { index: 1 }),
    candidate("first", all(4), { index: 0 }),
  ]);
  assert.equal(identical.leaderId, "first");
});

test("if every candidate is rejected, there is no leader; rejected ones list after ranked ones", () => {
  const none = rankCandidates([
    candidate("a", all(2), { index: 0 }),
    candidate("b", [5, 5, 5, 5, 5, 1], { index: 1 }),
    candidate("c", all(5), { index: 2, audioRole: "audio-led", variations: 1 }),
  ]);
  assert.equal(none.leaderId, null);
  assert.ok(none.scores.every((s) => s.rejected && s.rank === null));
  const mixed = rankCandidates([candidate("bad", all(1), { index: 0 }), candidate("ok", all(3), { index: 1 })]);
  assert.deepEqual(mixed.scores.map((s) => s.candidateId), ["ok", "bad"]);
});

/* ---------- Revision decision, on the Spark Score ---------- */

const allYes = { preservesMechanic: true, addressesWeakness: true, noUnsupportedClaims: true };
const scored = (scores: number[]) => scoreCandidate(candidate("x", scores));

test("revision with exactly +5 and all checks passing replaces the original", () => {
  const original = scored(all(3)); // 50
  const revised = scored([3, 4, 3, 3, 3, 3]); // stop power +1 × 20% → +5
  assert.ok(Math.abs(revised.rankingScore - original.rankingScore - 5) < 1e-9);
  const d = decideRevision(original, revised, allYes);
  assert.equal(d.outcome, "kept-revised");
  assert.ok(d.checks.every((c) => c.passed));
});

test("a gain under 5 keeps the original (+3.75)", () => {
  const d = decideRevision(scored(all(3)), scored([3, 3, 3, 4, 3, 3]), allYes); // watch-through +1 × 15%
  assert.equal(d.outcome, "kept-original");
  assert.equal(d.checks.find((c) => c.rule.startsWith("Improves the Spark Score"))!.passed, false);
});

test("a large gain still loses if the mechanic changed, the weakness wasn't addressed, or claims were added", () => {
  for (const broken of ["preservesMechanic", "addressesWeakness", "noUnsupportedClaims"] as const) {
    assert.equal(decideRevision(scored(all(3)), scored(all(5)), { ...allYes, [broken]: false }).outcome, "kept-original", broken);
  }
});

test("a rejected revision keeps the original, even with a big gain", () => {
  const revised = scored([5, 5, 5, 5, 5, 1]);
  assert.equal(revised.rejected, true);
  assert.equal(decideRevision(scored(all(3)), revised, allYes).outcome, "kept-original");
});

test("an equal or lower score keeps the original; no revision gives gain = null", () => {
  const original = scored(all(4));
  assert.equal(decideRevision(original, scored(all(4)), allYes).outcome, "kept-original");
  assert.equal(decideRevision(original, scored([4, 3, 4, 4, 4, 4]), allYes).outcome, "kept-original");
  const d = decideRevision(original, null, null);
  assert.equal(d.outcome, "kept-original");
  assert.equal(d.gain, null);
});

/* ---------- Day 5: fresh trends first, original formats as the fallback, stale trends never ---------- */

test("a stale trend idea is always rejected, however well it scores", () => {
  const s = scoreCandidate(candidate("x", all(5), { kind: "stale-trend" }));
  assert.equal(s.rejected, true);
  assert.ok(s.rejectionReasons.some((r) => r.code === "stale-trend"));
});

test("fresh trend ideas get a 5-point head start: they win near-ties, but a clearly stronger original wins", () => {
  // At an equal Spark Score, the fresh trend wins.
  const near = rankCandidates([
    candidate("original", [4, 4, 4, 4, 4, 4], { index: 0, kind: "original" }), // 75
    candidate("fresh", [3, 5, 4, 4, 4, 4], { index: 1, kind: "fresh-trend" }), // 75, ranks as 80
  ]);
  assert.equal(near.leaderId, "fresh");
  // The last Facebook test: an original at 58.75 beats a barely passing trend at 50 (55 with the head start).
  const clear = rankCandidates([
    candidate("trend", all(3), { index: 0, kind: "fresh-trend" }), // 50 → 55
    candidate("original", [3, 4, 4, 3, 3, 3], { index: 1, kind: "original" }), // 60
  ]);
  assert.equal(clear.leaderId, "original");
  const close = rankCandidates([
    candidate("trend", all(4), { index: 0, kind: "fresh-trend" }), // 75 → 80
    candidate("original", [4, 5, 4, 4, 4, 4], { index: 1, kind: "original" }), // 80
  ]);
  assert.equal(close.leaderId, "original", "an equal ranking value falls to the tie-break order (here, stop power)");
  // The displayed Spark Score never includes the head start.
  assert.equal(close.scores.find((s) => s.candidateId === "trend")!.rankingScore, 75);
});

test("an original format wins when no fresh trend idea clears the bar", () => {
  const r = rankCandidates([
    candidate("stale", all(5), { index: 0, kind: "stale-trend" }),
    candidate("weak-fresh", all(2), { index: 1, kind: "fresh-trend" }), // below 50
    candidate("original", all(4), { index: 2, kind: "original" }),
  ]);
  assert.equal(r.leaderId, "original");
  assert.equal(r.scores.find((s) => s.candidateId === "stale")!.rejected, true);
});

test("the 5.5-hour routine case: a high-scoring parody of a stale trend loses to a fresh trend and to an original format", () => {
  const r = rankCandidates([
    candidate("routine-parody", [4, 4, 5, 5, 3, 5], { index: 0, kind: "stale-trend" }),
    candidate("original", [3, 4, 4, 4, 4, 3], { index: 1, kind: "original" }),
  ]);
  assert.equal(r.leaderId, "original");
});

test("an idea that can't be made on a phone in a day is rejected, however well it scores", () => {
  const s = scoreCandidate(candidate("x", all(5), { makeable: false }));
  assert.equal(s.rejected, true);
  assert.ok(s.rejectionReasons.some((r) => r.code === "not-makeable"));
});

test("an idea that repeats one this person was already shown is rejected", () => {
  const s = scoreCandidate({ ...candidate("x", all(5)), repeatOf: { headline: "Finish this: I got so mad I waited for the brew", at: "2026-11-17T15:00:00Z" } });
  assert.equal(s.rejected, true);
  assert.ok(s.rejectionReasons.some((r) => r.code === "repeat" && r.message.includes("2026-11-17")));
  assert.equal(scoreCandidate(candidate("y", all(5))).rejected, false);
});
