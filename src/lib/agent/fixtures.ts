import { CRITERIA, type CriterionResult } from "../evaluation/scoring.ts";
import type { CandidateDraft, LonglistIdeaDraft } from "../spark-schema.ts";
import type { SignalDraft } from "./workspace.ts";

/** Shared test material for agent-mode tests. Nothing here is real research. */

export const NOW = new Date("2026-11-18T12:00:00Z");

export const FRESH_URL = "https://news.example.org/desk-reset-videos";
export const STALE_URL = "https://archive.example.net/2025-latte-art";
export const FRESH_QUOTE = "On November 10, 2026, creators began posting 'desk reset' videos before exams.";
export const STALE_QUOTE = "In March 2025, latte-art fails were a popular format.";

export const freshSearch = {
  query: "desk reset videos students",
  purpose: "cross-category" as const,
  results: [{ url: FRESH_URL, title: "Students turn desk resets into a ritual", pageAge: null }],
  citations: [{ url: FRESH_URL, citedText: FRESH_QUOTE }],
};

export const staleSearch = {
  query: "latte art fail videos",
  purpose: "category" as const,
  results: [{ url: STALE_URL, title: "The year of latte-art fails", pageAge: null }],
  citations: [{ url: STALE_URL, citedText: STALE_QUOTE }],
};

export function signal(name: string, citationId: string, dateText: string, overrides: Partial<SignalDraft> = {}): SignalDraft {
  return {
    name,
    category: "creator-format",
    categoryRelation: "adjacent",
    summary: `${name}, as the sources describe it.`,
    lineage: "None identified",
    novelty: "uncertain",
    whatIsNew: "",
    lookback: "Not checked",
    lineageQuery: "",
    creativeOpportunity: "",
    audienceNote: "Not documented",
    observations: [
      { statement: `${name} videos are being posted.`, kind: "presence", citationIds: [citationId], dateText, dateBasis: "behavior", attributedTo: "" },
    ],
    inferences: [],
    ...overrides,
  } as SignalDraft;
}

const TERRITORIES = [
  "result-first reveal",
  "comment-reply ritual",
  "pov skit",
  "checklist countdown",
  "duet challenge",
  "before-after split",
  "silent tutorial",
  "street interview",
  "myth bust",
  "day-in-the-life",
  "ranking tier list",
  "unboxing twist",
];

const NOUNS = ["receipts", "alarms", "playlists", "sticky notes", "group chats", "backpacks", "lunchboxes", "lanyards", "hoodies", "flashcards", "calendars", "mugs"];

export function longlistIdeas(n: number, groundedIn: string[] = []): LonglistIdeaDraft[] {
  return Array.from({ length: n }, (_, i) => ({
    trendName: `Format ${i + 1}`,
    headline: `Idea number ${i + 1} for the brand`,
    mechanic: `A ${TERRITORIES[i % TERRITORIES.length]} that turns ${NOUNS[i % NOUNS.length]} into the payoff.`,
    territory: TERRITORIES[i % TERRITORIES.length],
    basis: groundedIn.length ? "trend" : "original",
    groundedIn,
    distributionDrivers: ["shares"],
    distributionBet: "People send it to a friend who does the same thing.",
  }));
}

export function treatment(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    trendName: "Desk reset countdown",
    headline: "Reset your desk before the exam, in 30 seconds",
    concept: "A timed desk reset before a big exam, with the brand's coffee as the final placement. It's a ritual students already do.",
    mechanic: "A timed reset that ends on one hero object.",
    territory: "result-first reveal",
    basis: "trend",
    groundedIn: ["G1"],
    contextIn: [],
    evidenceBasis: "G1 shows students posting desk resets before exams.",
    creativeLeap: "The coffee is the last thing placed: the reward.",
    executionHypothesis: "A countdown holds attention to the reveal.",
    platformExecution: "Vertical, sped-up, on-screen timer.",
    walkthrough: "Open on a messy desk and a timer. Hands clear it fast. Last, the cup goes down. Cut to the student studying.",
    whyItWillSpread: "Students send it to the friend with the messiest desk.",
    audienceConnection: "",
    whyNow: "Exam season is starting.",
    timing: { hypothesis: "Exam weeks may make this relatable.", whatWouldConfirm: "More desk-reset posts tagged with exams." },
    audioRole: "audio-optional",
    audioVariations: [],
    signalsToVerify: [
      { signal: "Desk reset posts", whereToCheck: "Platform search", whyItMatters: "Confirms the behavior" },
      { signal: "Exam tags", whereToCheck: "Hashtag pages", whyItMatters: "Confirms the timing" },
      { signal: "Duets", whereToCheck: "Duet tab", whyItMatters: "Shows participation" },
    ],
    formatIdeas: [
      { title: "Speedrun", hook: "30 seconds. Go.", description: "A timed reset." },
      { title: "Roommate swap", hook: "Reset their desk.", description: "Reset a friend's desk." },
      { title: "Finals week", hook: "Day 1 vs day 7.", description: "A week of resets." },
    ],
    risks: ["Could feel staged.", "Exam stress is sensitive."],
    ...overrides,
  };
}

/** Review-panel results with the given 1–5 scores, in rubric order. */
export function results(scores: {
  culturalRelevance: number;
  stopPower: number;
  shareability: number;
  watchThrough: number;
  participation: number;
  brandPlatformFit: number;
}): CriterionResult[] {
  return CRITERIA.map((c) => ({ criterionId: c.id, status: "scored" as const, score: scores[c.id as keyof typeof scores], rationale: "Test rationale." }));
}

export const uniform = (n: number) => results({ culturalRelevance: n, stopPower: n, shareability: n, watchThrough: n, participation: n, brandPlatformFit: n });

export function assessment(candidateId: string, r: CriterionResult[], makeable = true) {
  return { candidateId, evaluatorLabel: "A", results: r, meaningfulAudioVariations: 0, makeable, makeableNote: "Phone and a desk." };
}
