import type { Platform } from "@/lib/types";

/**
 * Lightweight platform configuration for the Scout.
 *
 * Adding a platform later (e.g. Facebook, Snapchat) means adding one profile
 * here and one entry to PLATFORMS in types.ts. The research pipeline itself
 * doesn't change.
 */
export interface PlatformProfile {
  id: Platform;
  label: string;
  /** Words creators and press use for this platform's native formats. */
  nativeVocabulary: string[];
  /** Where useful, dated public evidence tends to appear. Guidance for the Scout, not a restriction. */
  usefulSourceHints: string[];
  /**
   * Domains owned by the platform itself. Their pages count as evidence that
   * something is happening, but never as independent confirmation.
   */
  ownedDomains: string[];
  /**
   * How ideas should be built for this platform: hook, pacing, participation
   * and conventions. General craft guidance for the Generator and Evaluator,
   * not data about performance.
   */
  creativeConventions: string[];
}

export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    nativeVocabulary: ["For You page", "sounds", "stitches", "duets", "trends", "creators", "TikTok Shop", "GRWM", "POV"],
    usefulSourceHints: [
      "TikTok's newsroom and creative-trend pages",
      "dated news coverage of creator trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["tiktok.com", "bytedance.com"],
    creativeConventions: [
      "Hook in the first second, usually on-screen text or a direct-to-camera line; the For You feed rewards instant clarity",
      "Fast, lo-fi, creator-led pacing; polish can read as an ad",
      "Participation is native: stitches, duets, reply-to-comment videos, and formats others can copy with their own twist",
      "Sounds and trends are shared building blocks, but the idea should survive without a specific track",
      "Series and recurring characters build return viewing",
    ],
  },
  "instagram-reels": {
    id: "instagram-reels",
    label: "Instagram Reels",
    nativeVocabulary: ["Reels", "remix", "templates", "audio", "carousels", "creators", "Explore"],
    usefulSourceHints: [
      "Instagram's and Meta's official announcements",
      "dated news coverage of creator trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["instagram.com", "about.instagram.com", "meta.com", "about.fb.com", "facebook.com"],
    creativeConventions: [
      "Visual-first: a strong opening frame and aesthetic payoff; it should work as a still too",
      "Slightly more crafted and curated than TikTok, often tied to an identity or lifestyle",
      "Sharing is the participation: content people send to friends in DMs or save for later",
      "Remix and templates let others reuse the format; Stories and carousels can extend it",
      "Audio from the Reels library is common, but the visual idea should carry it",
    ],
  },
  "youtube-shorts": {
    id: "youtube-shorts",
    label: "YouTube Shorts",
    nativeVocabulary: ["Shorts", "remix", "Shorts feed", "creators", "challenges"],
    usefulSourceHints: [
      "YouTube's official blog and culture and trends reports",
      "dated news coverage of creator trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["youtube.com", "blog.youtube", "google.com"],
    creativeConventions: [
      "A clear title-like promise and payoff; Shorts are also found through search, so evergreen questions work",
      "Loop-friendly endings that reward rewatching",
      "Explainers, how-tos and demonstrations fit naturally",
      "Can bridge to a longer video or channel; Shorts can remix moments from long-form",
      "Participation through comments and remixing clips, more than live trend-joining",
    ],
  },
};
