import type { Platform } from "@/lib/types";

/**
 * Lightweight platform configuration for the Scout.
 *
 * Adding a platform means adding one profile here, one entry to PLATFORMS in
 * types.ts, a form label and a demo template. The research pipeline itself
 * doesn't change. Each profile asks the models to consider every native
 * format, not just one.
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

/**
 * Day 5 scope (the user's direction): short-form content that is published to
 * the platform and can keep earning organic views over time. Photos, photo
 * mode, carousels, vertical video and text posts are in; live streams, AR
 * effects and Lenses, ephemeral Stories and paid ads are out.
 */
export const PLATFORM_PROFILES: Record<Platform, PlatformProfile> = {
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    nativeVocabulary: ["For You page", "photo mode", "carousels", "text posts", "sounds", "stitches", "duets", "creators", "GRWM", "POV"],
    usefulSourceHints: [
      "TikTok's newsroom and creative-trend pages",
      "dated news coverage of creator trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["tiktok.com", "bytedance.com"],
    creativeConventions: [
      "Formats to consider, all aimed at the For You feed: vertical video, photo mode carousels, and text posts. Vertical video often leads, but choose the format that fits the idea",
      "Hook in the first second, usually on-screen text or a direct-to-camera line; the For You feed rewards instant clarity",
      "Fast, lo-fi, creator-led pacing; polish can read as an ad",
      "Participation is native: stitches, duets, reply-to-comment videos, and formats others can copy with their own twist",
      "Sounds and trends are shared building blocks, but the idea should survive without a specific track",
      "Series and recurring characters build return viewing",
    ],
  },
  "instagram-reels": {
    id: "instagram-reels",
    label: "Instagram",
    nativeVocabulary: ["Reels", "feed posts", "carousels", "photo dumps", "remix", "templates", "audio", "Explore", "creators"],
    usefulSourceHints: [
      "Instagram's and Meta's official announcements",
      "dated news coverage of creator trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["instagram.com", "about.instagram.com", "meta.com", "about.fb.com", "facebook.com"],
    creativeConventions: [
      "Formats to consider: Reels, and feed posts (single photos, carousels, photo dumps and text-led graphics). Reels often leads, but a carousel or feed post can win when the idea is visual, swipeable or saveable",
      "Visual-first: a strong opening frame and aesthetic payoff; it should work as a still too",
      "Slightly more crafted and curated than TikTok, often tied to an identity or lifestyle",
      "Sharing is the participation: content people send to friends in DMs or save for later",
      "Carousels reward swiping to the last slide; Remix and templates let others reuse a Reel's format",
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
      "Format: Shorts, vertical video in the Shorts feed, including remixes of long-form moments",
      "A clear title-like promise and payoff; Shorts are also found through search, so evergreen questions work and keep earning views",
      "Loop-friendly endings that reward rewatching",
      "Explainers, how-tos and demonstrations fit naturally",
      "Participation through comments and remixing clips, more than live trend-joining",
    ],
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    nativeVocabulary: ["Facebook Reels", "feed posts", "photos", "multi-photo posts", "text posts", "feed video", "Pages", "shares", "creators"],
    usefulSourceHints: [
      "Meta's and Facebook's official announcements",
      "dated news coverage of creator and community trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["facebook.com", "fb.com", "fb.watch", "about.fb.com", "meta.com"],
    creativeConventions: [
      "Formats to consider: Reels, and feed posts (photos, multi-photo posts, feed video and text-only posts). Reels is where much short-form attention is, so leaning on it is fine when the idea suits it, but choose the format that fits the idea",
      "Hook in the first second and design for sound-off viewing with captions; much feed viewing is muted",
      "Shares and comments drive distribution: posts people tag friends and family in, debate, or share to their own feed and Groups",
      "Audiences span ages and life stages, with strong family, local and community ties; relatable, warm and funny ideas travel",
      "Text and photo posts that ask a question or invite a story can spark long comment threads",
    ],
  },
  snapchat: {
    id: "snapchat",
    label: "Snapchat",
    nativeVocabulary: ["Spotlight", "Snaps", "creators", "Snap Stars"],
    usefulSourceHints: [
      "Snap's newsroom and Snapchat's official trend reports",
      "dated news coverage of creator and youth culture trends",
      "marketing and culture trade press",
      "creator-economy newsletters",
    ],
    ownedDomains: ["snapchat.com", "snap.com"],
    creativeConventions: [
      "Format: Spotlight, Snapchat's public feed of vertical videos, where a post can keep earning views",
      "Camera-first and personal: raw, phone-shot, friend-to-friend energy; polish reads as an ad",
      "Vertical, full-screen and fast: a hook in the first second, often with captions",
      "Sharing is mostly private: content sent to friends and group chats more than discussed in public comments",
      "Simple, copyable bits travel: something viewers can recreate with friends in a few seconds",
    ],
  },
};
