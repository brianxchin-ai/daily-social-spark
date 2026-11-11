import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDiversity, type DiversityCandidate } from "./diversity.ts";

/*
 * These checks are deterministic labels. They catch near-duplicates that share
 * a territory label, their direct evidence and their wording. Two concepts
 * that are the same idea in different words are a semantic judgment these
 * tests can't prove.
 */

const c = (id: string, over: Partial<DiversityCandidate>): DiversityCandidate => ({
  id,
  trendName: id,
  territory: `${id} territory`,
  mechanic: `${id} mechanic`,
  concept: `${id} concept`,
  groundedIn: [],
  contextIn: [],
  ...over,
});

const ledgerWith = (relations: ("in-category" | "adjacent" | "off-category")[]) =>
  ({ signals: relations.map((r, i) => ({ id: `G${i + 1}`, categoryRelation: r })) }) as never;

test("acceptance: three near-duplicate ideas are identified and labeled, with no extra calls", () => {
  const report = checkDiversity(
    [
      c("A", { territory: "Result-first reveal", groundedIn: ["G1"], mechanic: "Show the finished face first, then rewind to bare skin as step one" }),
      c("B", { territory: "result-first reveal!", groundedIn: ["G1"], mechanic: "Open on the final look, then cut to the bare face as step one" }),
      c("C", { territory: "Minimal routine reveal", groundedIn: ["G1"], mechanic: "Show the finished face first, then rewind to bare skin as step one again" }),
    ],
    ledgerWith(["in-category"]),
  );
  // Every candidate is flagged in at least one pair…
  const flagged = new Set(report.nearDuplicates.flatMap((d) => [d.a, d.b]));
  assert.deepEqual([...flagged].sort(), ["A", "B", "C"]);
  assert.deepEqual(report.nearDuplicates.map((d) => `${d.a}-${d.b}`), ["A-B", "A-C"]);
  // …but B and C, the same idea in different words with different territory labels, aren't
  // caught as a pair directly. That is the semantic limit of deterministic checks.
  assert.ok(!report.nearDuplicates.some((d) => d.a === "B" && d.b === "C"));
});

test("genuinely distinct ideas aren't flagged", () => {
  const report = checkDiversity(
    [
      c("A", { territory: "Result-first reveal", groundedIn: ["G1"], mechanic: "Show the finished face first, then rewind to step one" }),
      c("B", { territory: "Comment-reply ritual", groundedIn: ["G2"], mechanic: "Answer comments with a timestamp instead of words" }),
      c("C", { territory: "Deadpan compression", groundedIn: ["G3"], mechanic: "Label a long process with two words and a hard cut" }),
    ],
    ledgerWith(["in-category", "off-category", "adjacent"]),
  );
  assert.deepEqual(report.nearDuplicates, []);
  assert.equal(report.offCategoryUsed, true);
  assert.deepEqual(report.notes, []);
});

test("unused off-category research is noted; using it only as context doesn't count", () => {
  const report = checkDiversity(
    [c("A", { groundedIn: ["G1"], contextIn: ["G2"] }), c("B", { groundedIn: ["G1"] }), c("C", { groundedIn: [] })],
    ledgerWith(["in-category", "off-category"]),
  );
  assert.equal(report.offCategoryAvailable, true);
  assert.equal(report.offCategoryUsed, false);
  assert.ok(report.notes.some((n) => n.includes("no candidate builds directly on one")));
});
