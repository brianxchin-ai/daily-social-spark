import { RECENT_IDEAS_DAYS, RECENT_IDEAS_MAX, type RecentIdea } from "@/lib/prompts/recent-ideas";
import type { Spark } from "@/lib/types";

/**
 * The visitor's recent ideas, kept only in their own browser (localStorage),
 * so the next scan can avoid repeating them. Nothing is stored on our side.
 * Every read and write is guarded: a blocked or empty store just means no memory.
 */

const KEY = "dss:recent-ideas:v1";

export function loadRecentIdeas(now = Date.now()): RecentIdea[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const cutoff = now - RECENT_IDEAS_DAYS * 86_400_000;
    return raw.filter((r) => r && typeof r.at === "string" && Date.parse(r.at) >= cutoff).slice(0, RECENT_IDEAS_MAX);
  } catch {
    return [];
  }
}

/** Remember the recommended idea and its three more ways in. */
export function rememberSpark(spark: Spark, now = new Date()): void {
  if (spark.origin !== "ai-hypothesis" || !spark.finalCandidate) return;
  const c = spark.finalCandidate;
  const at = now.toISOString();
  const shown: RecentIdea[] = [
    { at, trendName: c.trendName, headline: c.headline, mechanic: c.mechanic },
    ...c.formatIdeas.map((f) => ({ at, trendName: c.trendName, headline: f.hook || f.title, mechanic: f.description })),
  ];
  try {
    const next = [...shown, ...loadRecentIdeas(now.getTime())].slice(0, RECENT_IDEAS_MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // No storage available: the next scan simply has no memory.
  }
}
