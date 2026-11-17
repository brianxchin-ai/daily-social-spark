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

test("evaluator: execution judged for the brand, surprise rewarded, relevance judged honestly", () => {
  const e = evaluatorSystem("tiktok");
  for (const phrase of [
    "Judge the execution, not whether the original cultural signal was an obvious match",
    "Reward an unexpected but strategically compelling connection",
    "Don't give an obvious but unimaginative connection a strong score just for being obvious",
    "judged as two separate scores",
    "original narration, voiceover and dialogue are NOT dependencies",
    // Day 5: cultural relevance is AI judgment, a 5 is possible without proof, and the cutoff is acknowledged.
    "Score it 1 to 5 from your own judgment",
    "A 5 is available whenever you genuinely believe the idea expresses a specific, live cultural behavior or tension, even if no source proves it",
    "Your own knowledge of culture has a cutoff date; this scan's research is the only current information you have",
    "Don't be generous by default: a broad, familiar theme is a 3.",
    "research on a merely related topic isn't enough",
    "Novelty labels don't decide the score",
    'judgedFrom: "research", "general-knowledge" or "both"',
  ]) assert.ok(e.includes(phrase), phrase);
  // Momentum is no longer scored.
  assert.ok(!e.includes("emerging momentum"));
  assert.ok(!e.includes("proposedScore"));
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
  assert.ok(e.includes("Signals listed as context (contextIn) are background"));
});

test("generator: asks for one prose walkthrough, separate from the three format ideas", () => {
  for (const hasEvidence of [true, false]) {
    const g = generatorSystem("tiktok", hasEvidence);
    assert.ok(g.includes("walkthrough: a short production walkthrough of ONE execution"));
    assert.ok(g.includes("not a shot list"));
    assert.ok(g.includes("No statistics, handles or performance claims"));
    assert.ok(g.includes("formatIdeas: three further ways to run the idea, each different from the walkthrough"));
  }
});

test("generator: a longlist of 10, 3 picked for organic distribution and diversity, judged but never scored", () => {
  for (const hasEvidence of [true, false]) {
    const g = generatorSystem("instagram-reels", hasEvidence);
    for (const phrase of [
      "write exactly 10 short ideas (L1 to L10)",
      "how the idea would earn organic distribution on Instagram",
      "average watch time and completion, rewatches, shares and sends, saves, comments, and participation",
      "This is your creative judgment, not a forecast. Never predict numbers",
      "Pick the 3 ideas you believe would earn the highest organic distribution, while occupying genuinely distinct creative territories",
      "If your strongest ideas overlap, keep the strongest of them and pick the next-best distinct idea instead.",
      "Develop the 3 picks fully, in the same order as your picks",
      "don't give any idea a numeric score or rating",
    ]) assert.ok(g.includes(phrase), phrase);
    assert.ok(!g.includes("Do not rate, score or rank your own ideas"));
  }
});

test("Facebook and Snapchat: their own craft instructions, every native format considered", () => {
  const fb = generatorSystem("facebook", true);
  const sc = generatorSystem("snapchat", true);
  assert.notEqual(fb, sc);
  assert.ok(fb.includes("Formats to consider: Reels, and feed posts (photos, multi-photo posts, feed video and text-only posts)"));
  assert.ok(fb.includes("leaning on it is fine when the idea suits it, but choose the format that fits the idea"));
  assert.ok(sc.includes("Format: Spotlight, Snapchat's public feed of vertical videos"));
  assert.ok(evaluatorSystem("snapchat").includes("does it feel native to Snapchat"));
  assert.ok(generatorSystem("tiktok", true).includes("vertical video, photo mode carousels, and text posts"));
  assert.ok(generatorSystem("instagram-reels", true).includes("feed posts (single photos, carousels, photo dumps and text-led graphics)"));
});

test("format scope: published, lasting short-form only; no live streams, Lenses, Stories or ads", () => {
  for (const p of ["tiktok", "instagram-reels", "youtube-shorts", "facebook", "snapchat"] as const) {
    for (const prompt of [generatorSystem(p, true), evaluatorSystem(p)]) {
      assert.ok(prompt.includes("can keep earning organic views over time"), p);
      assert.ok(prompt.includes("Never propose live streams, AR effects or Lenses, ephemeral Stories, or paid ads"), p);
    }
    const conventions = generatorSystem(p, true).split("craft conventions")[1];
    assert.ok(!/\b(LIVE|Live|Lenses|Stories|Snap Map|Discover)\b/.test(conventions), `${p} conventions stay in scope`);
  }
  assert.ok(generatorSystem("tiktok", true).includes("For a photo, carousel or text post, walk through it image by image, slide by slide or line by line"));
});

test("three more ways: at least two keep the walkthrough's format; at most one switches", () => {
  const g = generatorSystem("facebook", true);
  assert.ok(g.includes("At least two of the three must use the same format as the walkthrough"));
  assert.ok(g.includes("At most one may switch to a different format, and only when that genuinely serves the idea better"));
});

test("freshness and original formats: stale trends are off-limits, originals are the fallback", () => {
  const g = generatorSystem("tiktok", true, false, "2026-11-17");
  for (const phrase of [
    "Never build a trend idea on a STALE or UNDATED signal, or on a trend you remember from your own knowledge",
    "Ground it in durable principles of attention and behavior",
    "calendar moments (today is 2026-11-17)",
    "It must not reference or imitate a specific meme or trend",
    "Include at least three original formats",
    "at least two picks must be trend ideas built on fresh signals; the third may be an original format. If it has none, all three picks are original formats.",
  ]) assert.ok(g.includes(phrase), phrase);
  assert.ok(generatorSystem("tiktok", false).includes('every idea, in the longlist and the picks, is an original format'));
  const e = evaluatorSystem("tiktok");
  assert.ok(e.includes("If they're STALE or UNDATED, or the trend reads as past its peak, score 2 or lower"));
  assert.ok(e.includes("score how timely and true its human insight is"));
});

test("reach-first rubric: the reviewer judges distribution behaviors, and makeability is a hard rule", () => {
  const e = evaluatorSystem("tiktok");
  for (const phrase of [
    '- stopPower: "Stop power". Does the first second stop the scroll',
    '- shareability: "Shareability". Would people send it to a friend, tag someone, or save it',
    '- watchThrough: "Watch-through and payoff"',
    '- participation: "Participation"',
    "Judge them as a strategist predicting real viewer behavior on this platform, not as an award jury",
    "Audio rule (a rejection rule, not a score)",
    "makeable is true only if one or two people could make it on a phone in a day",
  ]) assert.ok(e.includes(phrase), phrase);
  for (const gone of ["crossPlatform", "comprehension", "audioPortability", "remixability"]) assert.ok(!e.includes(`- ${gone}:`), gone);
  const g = generatorSystem("tiktok", true);
  assert.ok(g.includes("must be makeable on a phone by one or two people in a day"));
  assert.ok(g.includes("stopping the scroll in the first second"));
});
