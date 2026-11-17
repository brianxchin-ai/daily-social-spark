import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCandidateSet } from "../spark-schema.ts";

const candidate = (n: number) => ({
  trendName: `Trend ${n}`,
  headline: `Headline ${n}`,
  concept: "A concept.",
  mechanic: `Mechanic number ${n} works in its own way`,
  territory: `Territory ${n}`,
  basis: "original",
  groundedIn: [],
  contextIn: [],
  evidenceBasis: "No live evidence for this scan.",
  creativeLeap: "A leap.",
  executionHypothesis: "A hypothesis.",
  platformExecution: "Platform notes.",
  walkthrough: "Open on a shot. Something happens. It ends.",
  whyItWillSpread: "Because.",
  audienceConnection: "",
  whyNow: "Now.",
  timing: { hypothesis: "Maybe.", whatWouldConfirm: "Signals." },
  audioRole: "no-audio",
  audioVariations: [],
  signalsToVerify: [1, 2, 3].map((i) => ({ signal: `S${i}`, whereToCheck: "Search", whyItMatters: "It matters." })),
  formatIdeas: [1, 2, 3].map((i) => ({ title: `F${i}`, hook: "Hook", description: "Desc" })),
  risks: ["One", "Two"],
});

const idea = (n: number) => ({
  id: `L${n}`,
  trendName: `Idea ${n}`,
  headline: `Idea headline ${n}`,
  mechanic: "A mechanic.",
  territory: `Territory ${n}`,
  basis: "original",
  groundedIn: [],
  distributionDrivers: ["shares"],
  distributionBet: "People would send it to a friend who does this.",
});

function valid() {
  return {
    longlist: Array.from({ length: 10 }, (_, i) => idea(i + 1)),
    selection: {
      picks: [
        { id: "L2", reason: "Most shareable." },
        { id: "L5", reason: "Highest rewatch." },
        { id: "L9", reason: "Invites stitches." },
      ],
      setAside: "The rest overlapped or relied on one sound.",
    },
    candidates: [1, 2, 3].map(candidate),
  };
}

test("candidate set: a longlist of 10, 3 picks and 3 full candidates pass", () => {
  const r = validateCandidateSet(valid());
  assert.ok(r.ok, r.ok ? "" : r.problems.join("; "));
});

test("candidate set: the longlist must have exactly 10 ideas with unique IDs", () => {
  const short = valid();
  short.longlist.pop();
  assert.equal(validateCandidateSet(short).ok, false);
  const dup = valid();
  dup.longlist[1].id = "L1";
  assert.equal(validateCandidateSet(dup).ok, false);
});

test("candidate set: picks must be 3 different longlist IDs", () => {
  const unknown = valid();
  unknown.selection.picks[0].id = "L11";
  assert.equal(validateCandidateSet(unknown).ok, false);
  const repeated = valid();
  repeated.selection.picks[1].id = "L2";
  assert.equal(validateCandidateSet(repeated).ok, false);
});

test("candidate set: each bet names 1 to 3 known drivers and contains no URLs", () => {
  const none = valid();
  none.longlist[0].distributionDrivers = [];
  assert.equal(validateCandidateSet(none).ok, false);
  const many = valid();
  many.longlist[0].distributionDrivers = ["shares", "saves", "comments", "rewatch"];
  assert.equal(validateCandidateSet(many).ok, false);
  const unknownDriver = valid();
  unknownDriver.longlist[0].distributionDrivers = ["virality"];
  assert.equal(validateCandidateSet(unknownDriver).ok, false);
  const url = valid();
  url.longlist[3].distributionBet = "Like https://example.com did.";
  assert.equal(validateCandidateSet(url).ok, false);
});
