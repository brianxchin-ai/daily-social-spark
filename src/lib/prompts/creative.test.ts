import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatorSystem, generatorSystem } from "./creative.ts";

/* Acceptance 2 (deterministic part): platform choice changes what the models are told. */

test("acceptance 2: TikTok, Reels and Shorts get different craft instructions", () => {
  const tiktok = generatorSystem("tiktok", true);
  const reels = generatorSystem("instagram-reels", true);
  const shorts = generatorSystem("youtube-shorts", true);
  assert.notEqual(tiktok, reels);
  assert.notEqual(reels, shorts);
  assert.ok(tiktok.includes("stitches, duets, reply-to-comment videos"));
  assert.ok(reels.includes("send to friends in DMs"));
  assert.ok(shorts.includes("Loop-friendly endings"));
  for (const p of [tiktok, reels, shorts]) {
    assert.ok(p.includes("platformExecution"));
    assert.ok(p.includes("don't make a generic video and attach the platform name"));
  }
  assert.ok(evaluatorSystem("youtube-shorts").includes("does it feel native to YouTube Shorts"));
});

test("generator: brand shapes the idea, without equating fit with adjacency or inventing brand facts", () => {
  const g = generatorSystem("tiktok", true);
  for (const phrase of [
    "Make the brand or category materially change the idea",
    "Brand fit is not category adjacency",
    "A surprising but strategically compelling connection beats an obvious, unimaginative one",
    "don't invent facts about any particular brand",
  ]) assert.ok(g.includes(phrase), phrase);
});

test("generator: evidence, inference and hypothesis are kept apart; novelty doesn't decide potential", () => {
  const g = generatorSystem("tiktok", true);
  for (const phrase of [
    "evidenceBasis: only what the ledger's observations actually establish",
    "creativeLeap: your own interpretation",
    "executionHypothesis: what you think might work",
    "Novelty labels inform you but don't decide creative potential",
    "Don't favor a signal just because it is heavily documented",
    "If a signal's momentum is unverified, don't imply it is growing",
  ]) assert.ok(g.includes(phrase), phrase);
  const noEvidence = generatorSystem("tiktok", false);
  assert.ok(noEvidence.includes("No live research is available for this scan"));
  assert.ok(noEvidence.includes("groundedIn and contextIn: empty lists"));
});

test("evaluator: execution judged for the brand, surprise rewarded, evidence rules stated", () => {
  const e = evaluatorSystem("tiktok");
  for (const phrase of [
    "Judge the execution, not whether the original cultural signal was an obvious match",
    "Reward an unexpected but strategically compelling connection",
    "Don't give an obvious but unimaginative connection a strong score just for being obvious",
    "judged as two separate scores",
    "The evidence must support this candidate's specific cultural claim",
    "Never infer acceleration from recency, publication dates, popularity totals or novelty",
    "Novelty labels don't decide scores",
    "Original narration, voiceover and dialogue are NOT dependencies",
  ]) assert.ok(e.includes(phrase), phrase);
});

test("acceptance: the Generator is told to explore genuinely distinct mechanisms, not reworded duplicates", () => {
  const g = generatorSystem("tiktok", true);
  for (const phrase of [
    "Explore before you choose",
    "genuinely distinct creative territories",
    "Different wording, framing or treatment of essentially the same concept is NOT distinct",
    "Each candidate should rest on a different cultural signal or a different underlying creative mechanism",
    "at least one candidate should build on it",
    "Don't force irrelevant novelty",
    "Don't settle for several near-duplicates",
    "contextIn: signal IDs that are only context",
    "Context never counts as proof of the mechanism",
  ]) assert.ok(g.includes(phrase), phrase);
  const e = evaluatorSystem("tiktok");
  assert.ok(e.includes("don't reward unconventionality, or penalize a conventional approach, by itself"));
  assert.ok(e.includes("Signals listed as context (contextIn) never establish"));
});
