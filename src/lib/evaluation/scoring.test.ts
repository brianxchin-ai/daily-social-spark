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
} from "./scoring.ts";

/** All six criteria, in order: relevance, remix, comprehension, audio, fit, cross-platform. */
function candidate(
  id: string,
  [cr, r, c, a, f, x]: number[],
  opts: { index?: number; audioRole?: AudioRole; variations?: number; verified?: boolean } = {},
): CandidateInput {
  const scores: Record<string, number> = {
    culturalRelevance: cr,
    remixability: r,
    comprehension: c,
    audioPortability: a,
    brandPlatformFit: f,
    crossPlatform: x,
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
  };
}
const all = (n: number) => [n, n, n, n, n, n];

test("Day 5 framework: six criteria, momentum removed, weights as approved and summing to 100%", () => {
  const weights = Object.fromEntries(CRITERIA.map((c) => [c.id, Math.round(c.weight * 100)]));
  assert.deepEqual(weights, {
    culturalRelevance: 30,
    remixability: 20,
    comprehension: 15,
    audioPortability: 10,
    brandPlatformFit: 20,
    crossPlatform: 5,
  });
  assert.equal(Object.values(weights).reduce((s, w) => s + w, 0), 100);
  assert.ok(!CRITERIA.some((c) => (c.id as string) === "emergingMomentum"));
});

test("worked example: 4,5,4,3,4,3 → 4.05/5 → 76.25/100", () => {
  // .30×4 + .20×5 + .15×4 + .10×3 + .20×4 + .05×3 = 4.05 → (4.05 − 1) ÷ 4 × 100
  const c = candidate("x", [4, 5, 4, 3, 4, 3]);
  assert.ok(Math.abs(sparkScoreOf(c.results) - 76.25) < 1e-9);
  assert.ok(Math.abs(applicableScore(c.results).weight - 1) < 1e-9);
  assert.ok(Math.abs(scoreCandidate(c).rankingScore - 76.25) < 1e-9);
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
  missing.results = missing.results.filter((r) => r.criterionId !== "comprehension");
  assert.throws(() => scoreCandidate(missing), /Missing criterion/);
});

test("rejects a Spark Score below 50; exactly 50 passes", () => {
  const low = scoreCandidate(candidate("x", [2, 3, 3, 3, 3, 3])); // 2.7 → 42.5
  assert.equal(low.rejected, true);
  assert.equal(low.rejectionReasons[0].code, "below-threshold");
  assert.equal(scoreCandidate(candidate("y", all(3))).rejected, false);
});

test("fit of 1 rejects, even with a high score", () => {
  const s = scoreCandidate(candidate("x", [5, 5, 5, 5, 1, 5]));
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

test("ties break on remixability first, then the rest of the agreed order, then generation order", () => {
  // Remixability and fit both weigh 20%, so these totals are equal.
  const tie = rankCandidates([
    candidate("b", [4, 4, 4, 4, 5, 4], { index: 0 }),
    candidate("a", [4, 5, 4, 4, 4, 4], { index: 1 }),
  ]);
  assert.equal(tie.scores[0].rankingScore, tie.scores[1].rankingScore);
  assert.equal(tie.leaderId, "a", "higher remixability wins the tie");
  const identical = rankCandidates([
    candidate("second", all(4), { index: 1 }),
    candidate("first", all(4), { index: 0 }),
  ]);
  assert.equal(identical.leaderId, "first");
});

test("if every candidate is rejected, there is no leader; rejected ones list after ranked ones", () => {
  const none = rankCandidates([
    candidate("a", all(2), { index: 0 }),
    candidate("b", [5, 5, 5, 5, 1, 5], { index: 1 }),
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
  const revised = scored([3, 4, 3, 3, 3, 3]); // remixability +1 × 20% → +5
  assert.ok(Math.abs(revised.rankingScore - original.rankingScore - 5) < 1e-9);
  const d = decideRevision(original, revised, allYes);
  assert.equal(d.outcome, "kept-revised");
  assert.ok(d.checks.every((c) => c.passed));
});

test("a gain under 5 keeps the original (+3.75)", () => {
  const d = decideRevision(scored(all(3)), scored([3, 3, 4, 3, 3, 3]), allYes); // comprehension +1 × 15%
  assert.equal(d.outcome, "kept-original");
  assert.equal(d.checks.find((c) => c.rule.startsWith("Improves the Spark Score"))!.passed, false);
});

test("a large gain still loses if the mechanic changed, the weakness wasn't addressed, or claims were added", () => {
  for (const broken of ["preservesMechanic", "addressesWeakness", "noUnsupportedClaims"] as const) {
    assert.equal(decideRevision(scored(all(3)), scored(all(5)), { ...allYes, [broken]: false }).outcome, "kept-original", broken);
  }
});

test("a rejected revision keeps the original, even with a big gain", () => {
  const revised = scored([5, 5, 5, 5, 1, 5]);
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
