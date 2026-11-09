import type { Platform, Spark } from "@/lib/types";

/**
 * DEMO CONTENT ONLY.
 * Every trend, source, metric and recommendation below is invented
 * placeholder copy. Sources point at example.com on purpose.
 * Nothing here reflects live research.
 */

type DemoTemplate = (brand: string) => Omit<
  Spark,
  "id" | "isDemo" | "generatedAt" | "brand" | "platform"
>;

const tiktok: DemoTemplate = (brand) => ({
  trendName: "“Quiet Upgrade” before/afters",
  headline: `Show the one small change ${brand} makes that nobody notices—until they do`,
  whyItWillSpread:
    "Creators are posting deadpan before/after clips where the “after” looks almost identical, then reveal the subtle upgrade in the last second. The payoff rewards rewatching, which the algorithm loves.",
  whyNow:
    "The format jumped from lifestyle creators into brand accounts in the last day, but no major brand in this category has posted yet—a short first-mover window.",
  window: { peakInHours: 30, closesInHours: 48, stage: "accelerating" },
  confidence: 72,
  confidenceRationale:
    "Demo rationale: consistent growth across several (placeholder) sources, but the format is young and could fade quickly.",
  metrics: [
    { label: "Posts using the format", value: "18.4K", context: "Demo metric · last 24h" },
    { label: "Growth rate", value: "+212%", context: "Demo metric · vs. prior day" },
    { label: "Avg. rewatch rate", value: "1.9×", context: "Demo metric" },
  ],
  evidence: [
    {
      id: "tt-1",
      outlet: "Example Trends Weekly",
      title: "The anti-glow-up: why subtle reveals are winning",
      url: "https://example.com/demo/quiet-upgrade",
      publishedAgo: "6 hours ago",
      signal: "strong",
      note: "Placeholder article describing the format's crossover into brand accounts.",
    },
    {
      id: "tt-2",
      outlet: "Demo Creator Panel",
      title: "Sample of 40 creators reporting above-average completion",
      url: "https://example.com/demo/creator-panel",
      publishedAgo: "11 hours ago",
      signal: "moderate",
      note: "Invented panel data used to illustrate how evidence will appear.",
    },
    {
      id: "tt-3",
      outlet: "Sample Search Signals",
      title: "Search interest for “quiet upgrade” rising",
      url: "https://example.com/demo/search-signal",
      publishedAgo: "1 day ago",
      signal: "emerging",
      note: "Placeholder search signal; real data will replace this.",
    },
  ],
  formatIdeas: [
    {
      title: "The 1-second reveal",
      hook: "“Spot the difference. I'll wait.”",
      description: `Two near-identical shots of everyday life; the final frame reveals the ${brand} detail that changed.`,
    },
    {
      title: "Employee edition",
      hook: "“Our team's quietest upgrade this year”",
      description: "Someone from the team presents the subtle change straight to camera, deadpan.",
    },
    {
      title: "Stitch the community",
      hook: "“Show us yours”",
      description: "Invite followers to stitch with their own quiet upgrades featuring the product.",
    },
  ],
  risks: [
    "Reveal must be genuinely visible on a phone screen—too subtle reads as a mistake.",
    "Avoid claiming a product change that hasn't actually shipped.",
    "Format may feel dated after ~48 hours; don't schedule it for next week.",
  ],
});

const reels: DemoTemplate = (brand) => ({
  trendName: "One-take “desk session” demos",
  headline: `A single unbroken take of ${brand} doing its thing—no cuts, no music bed`,
  whyItWillSpread:
    "Audiences are rewarding unpolished, single-take product moments that feel like a live performance. Saves and shares are outpacing likes, a sign people are passing them along.",
  whyNow:
    "Several (placeholder) mid-size accounts saw outsized reach this morning; Reels tends to amplify a format for a day or two after this pattern appears.",
  window: { peakInHours: 24, closesInHours: 40, stage: "rising" },
  confidence: 64,
  confidenceRationale:
    "Demo rationale: strong share-to-like ratio in sample data, but fewer independent sources so far.",
  metrics: [
    { label: "Share-to-like ratio", value: "0.41", context: "Demo metric · category avg 0.12" },
    { label: "Accounts adopting", value: "2.3K", context: "Demo metric · last 24h" },
    { label: "Avg. watch time", value: "14s", context: "Demo metric" },
  ],
  evidence: [
    {
      id: "ig-1",
      outlet: "Example Social Desk",
      title: "One take, no edit: the Reels format quietly taking over",
      url: "https://example.com/demo/one-take",
      publishedAgo: "4 hours ago",
      signal: "moderate",
      note: "Placeholder explainer used to illustrate sourcing.",
    },
    {
      id: "ig-2",
      outlet: "Demo Benchmark Report",
      title: "Shares outpacing likes on unedited clips",
      url: "https://example.com/demo/benchmark",
      publishedAgo: "9 hours ago",
      signal: "strong",
      note: "Invented benchmark figures; not real platform data.",
    },
  ],
  formatIdeas: [
    {
      title: "The uninterrupted take",
      hook: "“No cuts. Watch the whole thing.”",
      description: `One continuous shot showing ${brand} from start to finish, natural sound only.`,
    },
    {
      title: "Behind-the-desk",
      hook: "“What our studio sounds like at 9am”",
      description: "A single take of the team at work with the product in frame.",
    },
  ],
  risks: [
    "One-take means one mistake is visible—rehearse before recording.",
    "Natural audio must be clean; muffled sound kills watch time.",
  ],
});

const shorts: DemoTemplate = (brand) => ({
  trendName: "“Myth vs. Maker” explainers",
  headline: `Let the person who makes ${brand} bust one myth about it in under 40 seconds`,
  whyItWillSpread:
    "Short myth-busting clips fronted by real makers are earning high comment counts as viewers debate. Shorts favours clips that spark replies.",
  whyNow:
    "The (placeholder) format surged after a creator collab yesterday; similar Shorts formats typically stay hot for about two days.",
  window: { peakInHours: 36, closesInHours: 48, stage: "rising" },
  confidence: 58,
  confidenceRationale:
    "Demo rationale: engagement looks promising in sample data, but the format is earliest-stage of the three demos.",
  metrics: [
    { label: "Comments per 1K views", value: "22", context: "Demo metric · category avg 6" },
    { label: "New uploads", value: "6.1K", context: "Demo metric · last 24h" },
    { label: "Avg. completion", value: "71%", context: "Demo metric" },
  ],
  evidence: [
    {
      id: "yt-1",
      outlet: "Example Video Insider",
      title: "Makers, not presenters: the myth-busting short is back",
      url: "https://example.com/demo/myth-vs-maker",
      publishedAgo: "8 hours ago",
      signal: "moderate",
      note: "Placeholder article; real coverage will be linked once research is live.",
    },
    {
      id: "yt-2",
      outlet: "Sample Comment Analysis",
      title: "Debate-style comments up sharply on maker-led clips",
      url: "https://example.com/demo/comment-analysis",
      publishedAgo: "14 hours ago",
      signal: "emerging",
      note: "Invented analysis for layout purposes.",
    },
  ],
  formatIdeas: [
    {
      title: "Myth on screen, maker on camera",
      hook: "“People think ___. Here's the truth.”",
      description: `Open with a common misconception about ${brand}; the maker answers in one take.`,
    },
    {
      title: "Comment reply series",
      hook: "“You asked, the maker answers”",
      description: "Turn the most-debated comments into follow-up Shorts.",
    },
  ],
  risks: [
    "Pick a myth you can disprove with evidence—debate can backfire.",
    "Avoid corporate scripting; the format works because it feels candid.",
  ],
});

export const DEMO_TEMPLATES: Record<Platform, DemoTemplate> = {
  tiktok,
  "instagram-reels": reels,
  "youtube-shorts": shorts,
};
