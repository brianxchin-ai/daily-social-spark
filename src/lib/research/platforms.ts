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
  },
};
