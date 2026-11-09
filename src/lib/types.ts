/**
 * The Spark "brief": the shape every scan result must follow.
 * The UI depends only on these types, so a real research engine can
 * replace the demo engine later without redesigning the page.
 */

export type Platform = "tiktok" | "instagram-reels" | "youtube-shorts";

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram-reels", label: "Instagram Reels" },
  { id: "youtube-shorts", label: "YouTube Shorts" },
];

/** What the person asks for when they press Run Scan. */
export interface ScanRequest {
  brand: string;
  platform: Platform;
}

/** How strongly a piece of evidence supports the opportunity. */
export type SignalStrength = "strong" | "moderate" | "emerging";

/** One piece of supporting evidence, shown like a footnote. */
export interface EvidenceSource {
  id: string;
  outlet: string;
  title: string;
  /** Demo sources use example.com and are never rendered as live links. */
  url: string;
  /** Human-readable recency, e.g. "6 hours ago". */
  publishedAgo: string;
  signal: SignalStrength;
  note: string;
}

/** A headline number that backs up the opportunity. */
export interface Metric {
  label: string;
  value: string;
  /** Optional short context, e.g. "vs. last 7 days". */
  context?: string;
}

/** The 24–48 hour window in which acting on the spark makes sense. */
export interface MomentumWindow {
  /** Hours from now until the trend is expected to peak. */
  peakInHours: number;
  /** Hours from now until the opportunity is likely stale. */
  closesInHours: number;
  stage: "rising" | "accelerating" | "near-peak";
}

/** A concrete creative execution idea. */
export interface FormatIdea {
  title: string;
  hook: string;
  description: string;
}

/** The single opportunity a scan returns. */
export interface Spark {
  id: string;
  /** True while results come from placeholder content, not live research. */
  isDemo: boolean;
  generatedAt: string;
  brand: string;
  platform: Platform;
  trendName: string;
  headline: string;
  whyItWillSpread: string;
  whyNow: string;
  window: MomentumWindow;
  /** 0–100 */
  confidence: number;
  confidenceRationale: string;
  metrics: Metric[];
  evidence: EvidenceSource[];
  formatIdeas: FormatIdea[];
  risks: string[];
}
