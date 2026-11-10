import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicableScore,
  CRITERIA,
  rankCandidates,
  scoreCandidate,
  type AudioRole,
  type CandidateInput,
  type CriterionId,
  type CriterionResult,
} from "./scoring.ts";

type Scores = Partial<Record<CriterionId, number | null>>;

/** Build a candidate. Evidence criteria default to unverified (Day 2). */
function candidate(
  id: string,
  scores: Scores,
  opts: { index?: number; audioRole?: AudioRole; variations?: number } = {},
): CandidateInput {
  const results: CriterionResult[] = CRITERIA.map((c) => {
    const value = scores[c.id] ?? null;
    return value === null
      ? { criterionId: c.id, status: "unverified", score: null, rationale: "Unverified" }
      : { criterionId: c.id, status: "scored", score: value, rationale: "r" };
  });
  return {
    candidateId: id,
    generationIndex: opts.index ?? 0,
    results,
    audioRole: opts.audioRole ?? "no-audio",
    meaningfulAudioVariations: opts.variations ?? 0,
  };
}

const concept = (r: number, c: number, a: number, f: number, x: number): Scores => ({
  remixability: r,
  comprehension: c,
  audioPortability: a,
  brandPlatformFit: f,
  crossPlatform: x,
});

test("weights sum to 100%, and concept criteria to 50%", () => {
  const total = CRITERIA.reduce((s, c) => s + c.weight, 0);
  const conceptTotal = CRITERIA.filter((c) => c.basis === "concept").reduce((s, c) => s + c.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(Math.abs(conceptTotal - 0.5) < 1e-9);
});

test("the user's worked example: 4,3,5,4,3,4,3 → 3.75/5 → 68.75/100", () => {
  const all: Scores = {
    culturalRelevance: 4,
    emergingMomentum: 3,
    remixability: 5,
    comprehension: 4,
    audioPortability: 3,
    brandPlatformFit: 4,
    crossPlatform: 3,
  };
  const { score, weight } = applicableScore(candidate("x", all).results);
  assert.ok(Math.abs(weight - 1) < 1e-9);
  assert.ok(Math.abs(score - 68.75) < 1e-9, `got ${score}`);
  assert.equal(scoreCandidate(candidate("x", all)).mode, "full");
});

test("Day 2 Concept Score uses only the five concept criteria, renormalized to 100", () => {
  // (5×.15 + 4×.10 + 3×.10 + 4×.10 + 3×.05) / .50 = 2.0 / .5 = 4.0 → 75
  const s = scoreCandidate(candidate("x", concept(5, 4, 3, 4, 3)));
  assert.ok(Math.abs(s.applicableScore - 75) < 1e-9, `got ${s.applicableScore}`);
  assert.ok(Math.abs(s.applicableWeight - 0.5) < 1e-9);
  assert.equal(s.mode, "concept");
  assert.equal(s.evidenceBacked, false);
});

test("all 5s → 100; all 1s → 0", () => {
  assert.equal(scoreCandidate(candidate("x", concept(5, 5, 5, 5, 5))).applicableScore, 100);
  assert.equal(scoreCandidate(candidate("x", concept(1, 1, 1, 1, 1))).applicableScore, 0);
});

test("unverified criteria carry no number and add nothing to the score", () => {
  const c = candidate("x", concept(4, 4, 4, 4, 4));
  const cultural = c.results.find((r) => r.criterionId === "culturalRelevance")!;
  assert.equal(cultural.status, "unverified");
  assert.equal(cultural.score, null);
  assert.equal(scoreCandidate(c).applicableScore, 75);
});

test("an unverified criterion carrying a number is refused", () => {
  const c = candidate("x", concept(4, 4, 4, 4, 4));
  c.results[0] = { criterionId: "culturalRelevance", status: "unverified", score: 3, rationale: "" };
  assert.throws(() => scoreCandidate(c), /must not carry a number/);
});

test("out-of-range, fractional or missing concept scores are refused", () => {
  assert.throws(() => scoreCandidate(candidate("x", concept(6, 4, 4, 4, 4))), /integer 1–5/);
  assert.throws(() => scoreCandidate(candidate("x", concept(3.5, 4, 4, 4, 4))), /integer 1–5/);
  const missing = candidate("x", concept(4, 4, 4, 4, 4));
  missing.results = missing.results.filter((r) => r.criterionId !== "comprehension");
  assert.throws(() => scoreCandidate(missing), /Missing criterion/);
});

test("rejects below 50, compared unrounded (49.99 does not pass)", () => {
  // (2×.15+3×.10+3×.10+3×.10+3×.05)/.5 = 1.35/.5 = 2.7 → 42.5
  const low = scoreCandidate(candidate("x", concept(2, 3, 3, 3, 3)));
  assert.equal(low.rejected, true);
  assert.equal(low.rejectionReasons[0].code, "below-threshold");
  assert.equal(low.rejectionKind, "provisional-creative");
  // Exactly 50 passes: (3×.15+3×.10+3×.10+3×.10+3×.05)/.5 = 3 → 50
  assert.equal(scoreCandidate(candidate("y", concept(3, 3, 3, 3, 3))).rejected, false);
});

test("fit of 1 rejects, even with a high score", () => {
  const s = scoreCandidate(candidate("x", concept(5, 5, 5, 1, 5)));
  assert.ok(s.applicableScore >= 50);
  assert.equal(s.rejected, true);
  assert.deepEqual(
    s.rejectionReasons.map((r) => r.code),
    ["fit-fails"],
  );
});

test("a 1 on another criterion does not reject on its own", () => {
  const s = scoreCandidate(candidate("x", concept(5, 1, 5, 5, 5)));
  assert.equal(s.rejected, false);
});

test("audio-led ideas need at least 3 meaningful alternatives", () => {
  const two = scoreCandidate(candidate("x", concept(5, 5, 5, 5, 5), { audioRole: "audio-led", variations: 2 }));
  assert.equal(two.rejected, true);
  assert.equal(two.rejectionReasons[0].code, "audio-dependent");
  const three = scoreCandidate(candidate("y", concept(5, 5, 5, 5, 5), { audioRole: "audio-led", variations: 3 }));
  assert.equal(three.rejected, false);
  const optional = scoreCandidate(candidate("z", concept(5, 5, 5, 5, 5), { audioRole: "audio-optional" }));
  assert.equal(optional.rejected, false);
});

test("ranks by score, highest first", () => {
  const r = rankCandidates([
    candidate("a", concept(3, 3, 3, 3, 3), { index: 0 }),
    candidate("b", concept(5, 5, 5, 5, 5), { index: 1 }),
    candidate("c", concept(4, 4, 4, 4, 4), { index: 2 }),
  ]);
  assert.deepEqual(r.scores.map((s) => s.candidateId), ["b", "c", "a"]);
  assert.deepEqual(r.scores.map((s) => s.rank), [1, 2, 3]);
  assert.equal(r.leaderId, "b");
  assert.equal(r.leaderEvidenceBacked, false);
});

test("ties break on remixability, then comprehension, then generation order", () => {
  // Same total, different shape:
  // a: r5 c3 a3 f3 x3 → .75+.30+.30+.30+.15 = 1.80
  // b: r3 c5 a4 f3 x3 → .45+.50+.40+.30+.15 = 1.80  (tie; a has higher remixability)
  const tie = rankCandidates([
    candidate("b", concept(3, 5, 4, 3, 3), { index: 0 }),
    candidate("a", concept(5, 3, 3, 3, 3), { index: 1 }),
  ]);
  assert.equal(tie.scores[0].applicableScore, tie.scores[1].applicableScore);
  assert.equal(tie.leaderId, "a", "higher remixability wins the tie");

  const identical = rankCandidates([
    candidate("second", concept(4, 4, 4, 4, 4), { index: 1 }),
    candidate("first", concept(4, 4, 4, 4, 4), { index: 0 }),
  ]);
  assert.equal(identical.leaderId, "first", "fully identical scores fall back to generation order");
});

test("if every candidate is rejected, there is no leader", () => {
  const r = rankCandidates([
    candidate("a", concept(2, 2, 2, 2, 2), { index: 0 }),
    candidate("b", concept(5, 5, 5, 1, 5), { index: 1 }),
    candidate("c", concept(5, 5, 5, 5, 5), { index: 2, audioRole: "audio-led", variations: 1 }),
  ]);
  assert.equal(r.leaderId, null);
  assert.ok(r.scores.every((s) => s.rejected && s.rank === null));
});

test("rejected candidates are listed after ranked ones", () => {
  const r = rankCandidates([
    candidate("bad", concept(1, 1, 1, 1, 1), { index: 0 }),
    candidate("ok", concept(3, 3, 3, 3, 3), { index: 1 }),
  ]);
  assert.deepEqual(r.scores.map((s) => s.candidateId), ["ok", "bad"]);
});

test("Day 3 readiness: partial evidence is never presented as evidence-backed", () => {
  const partial = scoreCandidate(candidate("x", { ...concept(4, 4, 4, 4, 4), culturalRelevance: 4 }));
  assert.equal(partial.mode, "partial");
  assert.equal(partial.evidenceBacked, false);
  assert.equal(partial.rejectionKind, null);

  const full = rankCandidates([
    candidate("x", { ...concept(4, 4, 4, 4, 4), culturalRelevance: 4, emergingMomentum: 4 }),
  ]);
  assert.equal(full.leaderEvidenceBacked, true);

  const fullReject = scoreCandidate(
    candidate("y", { ...concept(2, 2, 2, 2, 2), culturalRelevance: 2, emergingMomentum: 2 }),
  );
  assert.equal(fullReject.rejectionKind, "evidence-based");
});
