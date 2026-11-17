import type { EvidenceLedger, SourceRecord } from "./ledger.ts";

/**
 * The links shown under "Why this idea". Built only from the research ledger:
 * sources the search actually returned, reached through the idea's own
 * signals and their cited observations. The AI never supplies a URL here.
 */

export interface IdeaSource {
  id: string;
  url: string;
  domain: string;
  title: string;
  pageUpdated: string | null;
  /** A social platform page (a post, profile or video) rather than an article. */
  kind: "social" | "article";
  /** Direct evidence for the idea's mechanism, or context only. */
  role: "direct" | "context";
}

const SOCIAL_DOMAINS = [
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "threads.net",
  "threads.com",
  "x.com",
  "twitter.com",
  "snapchat.com",
  "reddit.com",
  "pinterest.com",
  "linkedin.com",
];

export function isSocialDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return SOCIAL_DOMAINS.some((s) => d === s || d.endsWith(`.${s}`));
}

/** Only real web links are ever rendered. */
export function safeHttpUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function sourcesForIdea(
  idea: { groundedIn: string[]; contextIn: string[] },
  ledger: EvidenceLedger | null,
  limit = 6,
): IdeaSource[] {
  if (!ledger) return [];
  const byId = new Map<string, SourceRecord>(ledger.sources.map((s) => [s.id, s]));
  const out: IdeaSource[] = [];
  const seen = new Set<string>();

  const collect = (signalIds: string[], role: IdeaSource["role"]) => {
    for (const signalId of signalIds) {
      const signal = ledger.signals.find((s) => s.id === signalId);
      if (!signal) continue;
      for (const obsId of signal.observationIds) {
        const obs = ledger.observations.find((o) => o.id === obsId);
        if (!obs) continue;
        for (const sourceId of obs.sourceIds) {
          const source = byId.get(sourceId);
          if (!source || source.setAside || seen.has(source.id)) continue;
          const url = safeHttpUrl(source.url);
          if (!url) continue;
          seen.add(source.id);
          out.push({
            id: source.id,
            url,
            domain: source.domain,
            title: source.title || source.domain,
            pageUpdated: source.pageUpdated,
            kind: isSocialDomain(source.domain) ? "social" : "article",
            role,
          });
        }
      }
    }
  };

  collect(idea.groundedIn, "direct");
  collect(idea.contextIn, "context");
  return out.slice(0, limit);
}
