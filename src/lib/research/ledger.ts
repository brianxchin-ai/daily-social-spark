import { z } from "zod";
import type { Platform } from "@/lib/types";
import { PLATFORM_PROFILES } from "./platforms.ts";

/**
 * The evidence ledger: the Scout's findings, checked by our code.
 *
 * The AI proposes signals and observations. Code decides what counts:
 *  - Sources come only from the search results the API actually returned.
 *  - Quotes come only from the API's own citations.
 *  - An "observation" must cite real quotes; otherwise it becomes an inference.
 *  - Numbers must appear in the cited quotes.
 *  - A behavior's date must be an absolute date written in a cited quote.
 *    A page's "last updated" date never counts as when something happened.
 *  - Sources repeating the same origin count once; platform- and brand-owned
 *    pages never count as independent confirmation.
 *  - Whether the evidence is enough to score a criterion is computed here,
 *    never stated by the AI. These thresholds are starting heuristics, not
 *    proof of a trend.
 */

/* ---------- Thresholds (starting heuristics, tunable) ---------- */

export const RELEVANCE_WINDOW_DAYS = 30;
export const MOMENTUM_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const NEAR_DUPLICATE_JACCARD = 0.5;

/* ---------- What the Scout's two steps hand to our code ---------- */

/** One search the Scout ran, exactly as the API reported it. */
export interface RawSearch {
  query: string | null;
  results: { url: string; title: string; pageAge: string | null }[] | null;
  /** Set when the API reported the search as failed. */
  errorCode: string | null;
}

/** One citation the API attached to the Scout's notes. */
export interface RawCitation {
  url: string;
  citedText: string;
}

export const NOVELTY = ["emerging", "evolving", "derivative", "established", "uncertain"] as const;
export type Novelty = (typeof NOVELTY)[number];

export const SIGNAL_CATEGORIES = [
  "meme",
  "creator-behavior",
  "language",
  "entertainment",
  "music",
  "sports",
  "fashion",
  "celebrity",
  "platform-format",
  "other",
] as const;

/** Volume limits. The API can't enforce array sizes, so the filing prompt states them too. */
export const MAX_SIGNALS = 10;

/** Scout step 2's output shape (structured output, then our rules). */
export const LedgerDraftSchema = z.object({
  signals: z
    .array(
      z.object({
        name: z.string().min(1).describe("Short name of the pattern, e.g. 'makeup bag declutter edits'."),
        category: z.enum(SIGNAL_CATEGORIES),
        categoryRelation: z
          .enum(["in-category", "adjacent", "off-category"])
          .describe("How the signal relates to the brand's own category: inside it, next to it, or from a different part of culture."),
        summary: z.string().min(1).describe("One or two sentences on what the sources show, without adding claims."),
        lineage: z
          .string()
          .describe(
            "The established mechanisms or influences it draws on (e.g. 'the [blank]maxxing construction'), or 'None identified'. Having ancestors doesn't rule out emerging.",
          ),
        novelty: z
          .enum(NOVELTY)
          .describe(
            "emerging: a potentially distinctive new mechanism, even if it draws on known influences. evolving: a meaningful transformation of an existing mechanism (new meaning, behavior or adoption dynamic). derivative: an established mechanism with a new surface variation (subject, modifier, wording or aesthetic). established: mature or saturated. uncertain: novelty can't be determined reliably.",
          ),
        whatIsNew: z
          .string()
          .describe("What is new about the underlying mechanism, not just the wording or subject. Required for emerging and evolving; otherwise may be empty."),
        lookback: z
          .string()
          .describe("What a lineage or history check found, including on the parent template, or 'Not checked'. No older results is not proof of novelty."),
        lineageQuery: z
          .string()
          .describe("The exact search you ran to check this signal's lineage or history, copied from the list of searches. Empty string if none."),
        creativeOpportunity: z
          .string()
          .describe("Why it could still be creatively useful, as a hypothesis (derivative signals can be). Empty string if none."),
        observations: z
          .array(
            z.object({
              statement: z.string().min(1).describe("What the cited sources state. No interpretation."),
              kind: z
                .enum(["presence", "growth"])
                .describe("presence: it is happening. growth: the quote itself describes an increase over time."),
              citationIds: z.array(z.string()).describe("IDs like C3 from the citation list. Only real IDs."),
              dateText: z
                .string()
                .describe(
                  "An absolute date copied exactly from a cited quote, e.g. 'October 28, 2026' or 'October 2026'. Empty string if the quotes contain no absolute date. Never a relative phrase like 'this week'.",
                ),
              dateBasis: z
                .enum(["published", "behavior", "other", "none"])
                .describe(
                  "published: the quote states when the article was published (a dateline, 'Published…'). behavior: when the behavior or event itself happened. other: a date attached to a measurement, example or page element ('counts as of…'). none: no date.",
                ),
              attributedTo: z
                .string()
                .describe("Who the source credits for the information (e.g. 'TikTok newsroom', a press release). Empty string if none."),
            }),
          )
          .min(1)
          .max(8),
        inferences: z.array(z.string()).max(4).describe("Your interpretation. Clearly not stated by any source."),
      }),
    )
    .max(MAX_SIGNALS),
  gaps: z.array(z.string()).max(10).describe("What you looked for but could not find or confirm."),
  categoryTerms: z
    .array(z.string())
    .max(12)
    .describe("Words that name the brand's own category or industry, e.g. 'beauty', 'makeup', 'skincare'."),
  searchPurposes: z
    .array(
      z.object({
        query: z.string().describe("A search you ran, copied exactly."),
        purpose: z.enum(["brand", "category", "cross-category", "depth"]),
      }),
    )
    .max(12)
    .describe("Why you ran each search."),
});
export type LedgerDraft = z.infer<typeof LedgerDraftSchema>;

/* ---------- The checked ledger ---------- */

export interface SourceRecord {
  id: string; // S1, S2…
  url: string;
  domain: string;
  title: string;
  /** The API's page_age: when the page was last updated. Context only, never a behavior date. */
  pageUpdated: string | null;
  query: string | null;
  /** Set aside: the page contains instructions aimed at AI systems. Its quotes aren't used. */
  setAside: boolean;
}

export interface CitationRecord {
  id: string; // C1, C2…
  sourceId: string;
  /** Verbatim text from the source, supplied by the API (up to ~150 characters). */
  quote: string;
}

export type Timeframe =
  | { status: "known"; date: string; precision: "day" | "month"; dateText: string }
  | { status: "unknown"; reason: string };

/** When the article was published. Never when the behavior happened. */
export interface PublishedDate {
  date: string;
  precision: "day" | "month";
  dateText: string;
  /** The source whose quote shows this date. */
  sourceId: string;
  /** True when copied from another observation quoting the same article. */
  shared: boolean;
}

export interface LedgerObservation {
  id: string; // O1, O2…
  signalId: string;
  statement: string;
  kind: "presence" | "growth";
  citationIds: string[];
  sourceIds: string[];
  /** When the behavior or event happened. Only this date counts toward recency rules. */
  behavior: Timeframe;
  /** When the article was published: context and an upper bound, never the behavior's timeframe. */
  published: PublishedDate | null;
  attributedTo: string | null;
  /** Merged origin after attribution and near-duplicate checks. */
  originKey: string;
  /** Platform- or brand-owned: evidence of presence, never independent confirmation. */
  owned: boolean;
}

export interface LedgerInference {
  signalId: string;
  statement: string;
  /** "scout": offered as interpretation. Others: downgraded by our checks. */
  basis: "scout" | "uncited" | "number-not-in-quote";
}

export interface CriterionEligibility {
  status: "eligible" | "unverified";
  /** Highest score the evidence allows (4 at minimum evidence, 5 when stronger). */
  maxScore: 4 | 5 | null;
  independentOrigins: number;
  reason: string;
}

export interface LedgerSignal {
  id: string; // G1, G2…
  name: string;
  category: (typeof SIGNAL_CATEGORIES)[number];
  /** The Scout's judgment of how far the signal sits from the brand's category. */
  categoryRelation: "in-category" | "adjacent" | "off-category";
  summary: string;
  /** The Scout's assessment, lightly checked by code. Separate from evidence strength and momentum. */
  novelty: Novelty;
  /** The established template it derives from, or null if none was identified. */
  lineage: string | null;
  whatIsNew: string;
  lookback: string;
  /**
   * True only when the Scout names a lineage search that matches a search the
   * API actually recorded. Says a check happened, not what it proved.
   */
  noveltyChecked: boolean;
  /** The recorded search used for the lineage check, if any. */
  lineageQuery: string | null;
  /** The Scout's creative hypothesis, kept separate from novelty and evidence. */
  creativeOpportunity: string;
  observationIds: string[];
  culturalRelevance: CriterionEligibility;
  momentum: CriterionEligibility;
}

export interface EvidenceLedger {
  version: 1;
  brand: string;
  platform: Platform;
  createdAt: string;
  queries: string[];
  searchErrors: string[];
  sources: SourceRecord[];
  citations: CitationRecord[];
  signals: LedgerSignal[];
  observations: LedgerObservation[];
  inferences: LedgerInference[];
  gaps: string[];
  /** What our checks changed or rejected, for the trace. */
  adjustments: string[];
  /**
   * Discovery breadth. brandFreeSearches is pure text matching. crossCategorySearches
   * are searches the Scout labeled cross-category that were actually run and
   * contain neither the brand nor any of the category terms it named.
   */
  discovery: { searches: number; brandFreeSearches: number; crossCategorySearches: number; categoryTerms: string[] };
}

/* ---------- Step A: source register and citations (from API data only) ---------- */

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function buildRegister(
  searches: RawSearch[],
  rawCitations: RawCitation[],
): { sources: SourceRecord[]; citations: CitationRecord[]; queries: string[]; searchErrors: string[]; adjustments: string[] } {
  const sources: SourceRecord[] = [];
  const byUrl = new Map<string, SourceRecord>();
  const queries: string[] = [];
  const searchErrors: string[] = [];
  const adjustments: string[] = [];

  for (const search of searches) {
    if (search.query) queries.push(search.query);
    if (search.errorCode) searchErrors.push(search.errorCode);
    for (const r of search.results ?? []) {
      const key = normalizeUrl(r.url);
      if (!domainOf(r.url) || byUrl.has(key)) continue;
      const record: SourceRecord = {
        id: `S${sources.length + 1}`,
        url: r.url,
        domain: domainOf(r.url),
        title: r.title,
        pageUpdated: r.pageAge,
        query: search.query,
        setAside: looksLikeInjection(r.title),
      };
      sources.push(record);
      byUrl.set(key, record);
    }
  }

  const citations: CitationRecord[] = [];
  const seen = new Set<string>();
  for (const c of rawCitations) {
    const source = byUrl.get(normalizeUrl(c.url));
    if (!source) {
      adjustments.push(`Dropped a citation to a page the search didn't return (${domainOf(c.url) || "unknown site"}).`);
      continue;
    }
    const quote = c.citedText.trim();
    if (!source.setAside && looksLikeInjection(quote)) source.setAside = true;
    const dedupe = `${source.id}|${quote}`;
    if (!quote || seen.has(dedupe)) continue;
    seen.add(dedupe);
    citations.push({ id: `C${citations.length + 1}`, sourceId: source.id, quote });
  }

  // Pages that try to instruct AI systems are kept in the register for the
  // trace, but none of their quotes can support an observation.
  const setAside = new Set(sources.filter((s) => s.setAside).map((s) => s.id));
  for (const s of sources.filter((x) => x.setAside)) {
    adjustments.push(`Set aside ${s.domain}: it contains instructions aimed at AI systems, so it isn't used as evidence.`);
  }
  const usable = citations
    .filter((c) => !setAside.has(c.sourceId))
    .map((c, i) => ({ ...c, id: `C${i + 1}` }));

  return { sources, citations: usable, queries, searchErrors, adjustments };
}

/** Text written to steer an AI reader rather than inform a human one. */
const INJECTION =
  /\b(ignore|disregard|forget|override)\b[^.]{0,30}\b(previous|prior|above|earlier|your|all)\s+(instructions?|rules|prompts?|guidelines)\b|\b(system prompt|you are an? (ai|assistant|language model)|as an ai)\b|\b(rate|score) this\b.{0,20}\b\d\s*\/\s*\d\b/i;
export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

/* ---------- Step B: text checks ---------- */

const squash = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Numbers in a statement (counts, percentages, years). Each must appear in a cited quote. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

export function numbersSupported(statement: string, quotes: string[]): boolean {
  const quoteNumbers = new Set(quotes.flatMap(numbersIn));
  return numbersIn(statement).every((n) => quoteNumbers.has(n));
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const monthIndex = (m: string) => MONTHS.findIndex((full) => full.startsWith(m.toLowerCase().replace(/\.$/, "").slice(0, 3)));
const RELATIVE = /\b(today|yesterday|tonight|this (week|weekend|month|year|season)|last (week|weekend|month|night|year)|past (few )?(days|weeks|months)|recently|lately|days? ago|weeks? ago|months? ago|right now|currently)\b/i;

/**
 * Parse an absolute date. Relative phrases ("this week") and year-only dates
 * are rejected: they can't place a behavior in a 14- or 30-day window.
 */
export function parseAbsoluteDate(text: string): { date: string; precision: "day" | "month" } | null {
  const t = text.trim();
  if (!t || RELATIVE.test(t)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, precision: "day" };

  m = t.match(new RegExp(`^${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, "i"));
  if (m) return { date: `${m[3]}-${pad(monthIndex(m[1]) + 1)}-${pad(Number(m[2]))}`, precision: "day" };

  m = t.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE},?\\s+(\\d{4})$`, "i"));
  if (m) return { date: `${m[3]}-${pad(monthIndex(m[2]) + 1)}-${pad(Number(m[1]))}`, precision: "day" };

  m = t.match(new RegExp(`^${MONTH_RE},?\\s+(\\d{4})$`, "i"));
  if (m) return { date: `${m[2]}-${pad(monthIndex(m[1]) + 1)}`, precision: "month" };

  return null;
}

/** A behavior's timeframe: only from an absolute date written in a cited quote. */
export function resolveTimeframe(dateText: string, quotes: string[], now: Date): Timeframe {
  const text = dateText.trim();
  if (!text) return { status: "unknown", reason: "No date appears in the cited quotes." };
  if (RELATIVE.test(text)) {
    return { status: "unknown", reason: `"${text}" is relative, and no reliable publication or event date anchors it.` };
  }
  if (!quotes.some((q) => squash(q).includes(squash(text)))) {
    return { status: "unknown", reason: "The date given isn't in the cited quotes." };
  }
  const parsed = parseAbsoluteDate(text);
  if (!parsed) return { status: "unknown", reason: `"${text}" isn't specific enough to place in time.` };
  const when = startOf(parsed.date);
  if (Number.isNaN(when) || when > now.getTime() + DAY_MS) {
    return { status: "unknown", reason: `"${text}" is in the future or invalid.` };
  }
  return { status: "known", date: parsed.date, precision: parsed.precision, dateText: text };
}

/** Month-precision dates count from the 1st (the conservative, older end). */
function startOf(date: string): number {
  return Date.parse(date.length === 7 ? `${date}-01T00:00:00Z` : `${date}T00:00:00Z`);
}

export function startOfDate(date: string): number {
  return startOf(date);
}

export function ageInDays(timeframe: Timeframe, now: Date): number | null {
  if (timeframe.status !== "known") return null;
  return Math.floor((now.getTime() - startOf(timeframe.date)) / DAY_MS);
}

function shingles(text: string, size = 4): Set<string> {
  const words = squash(text).replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function nearDuplicate(a: string, b: string): boolean {
  const x = shingles(a);
  const y = shingles(b);
  if (x.size === 0 || y.size === 0) return false;
  let shared = 0;
  for (const s of x) if (y.has(s)) shared++;
  return shared / (x.size + y.size - shared) >= NEAR_DUPLICATE_JACCARD;
}

const keyOf = (s: string) => squash(s).replace(/^the /, "").replace(/[^a-z0-9 ]/g, "").trim();

function isOwned(domain: string, attributedTo: string | null, brand: string, platform: Platform): boolean {
  const owned = PLATFORM_PROFILES[platform].ownedDomains;
  if (owned.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (brandKey.length >= 4 && domain.replace(/[^a-z0-9]/g, "").includes(brandKey)) return true;
  if (attributedTo) {
    const who = keyOf(attributedTo);
    const label = keyOf(PLATFORM_PROFILES[platform].label);
    if (brandKey.length >= 4 && who.replace(/ /g, "").includes(brandKey)) return true;
    if (who.includes(label) || label.split(" ").some((w) => w.length >= 6 && who.includes(w))) return true;
  }
  return false;
}

/* ---------- Step C: check the draft and compute eligibility ---------- */

export function checkLedger(input: {
  brand: string;
  platform: Platform;
  now: Date;
  draft: LedgerDraft;
  register: ReturnType<typeof buildRegister>;
}): EvidenceLedger {
  const { brand, platform, now, draft, register } = input;
  const citationById = new Map(register.citations.map((c) => [c.id, c]));
  const sourceById = new Map(register.sources.map((s) => [s.id, s]));
  const adjustments = [...register.adjustments];
  const observations: LedgerObservation[] = [];
  const inferences: LedgerInference[] = [];
  const signals: LedgerSignal[] = [];

  draft.signals.forEach((rawSignal, si) => {
    const signalId = `G${si + 1}`;
    const signalObs: LedgerObservation[] = [];

    for (const o of rawSignal.observations) {
      const valid = [...new Set(o.citationIds)].filter((id) => citationById.has(id));
      const invalid = o.citationIds.filter((id) => !citationById.has(id));
      if (invalid.length) adjustments.push(`${signalId}: removed unknown citation ID(s) ${invalid.join(", ")}.`);
      if (valid.length === 0) {
        inferences.push({ signalId, statement: o.statement, basis: "uncited" });
        adjustments.push(`${signalId}: an uncited observation was treated as an inference.`);
        continue;
      }
      const quotes = valid.map((id) => citationById.get(id)!.quote);
      if (!numbersSupported(o.statement, quotes)) {
        inferences.push({ signalId, statement: o.statement, basis: "number-not-in-quote" });
        adjustments.push(`${signalId}: an observation with a figure not found in its quotes was treated as an inference.`);
        continue;
      }
      const sourceIds = [...new Set(valid.map((id) => citationById.get(id)!.sourceId))];
      const domain = sourceById.get(sourceIds[0])!.domain;
      const attributedTo = o.attributedTo.trim() || null;
      const obs: LedgerObservation = {
        id: `O${observations.length + 1}`,
        signalId,
        statement: o.statement,
        kind: o.kind,
        citationIds: valid,
        sourceIds,
        ...dates(o.dateText, o.dateBasis, valid, citationById, now, adjustments),
        attributedTo,
        originKey: attributedTo ? `by:${keyOf(attributedTo)}` : `site:${domain}`,
        owned: isOwned(domain, attributedTo, brand, platform),
      };
      observations.push(obs);
      signalObs.push(obs);
    }

    mergeDuplicateOrigins(signalObs, citationById);
    for (const statement of rawSignal.inferences) inferences.push({ signalId, statement, basis: "scout" });

    signals.push({
      id: signalId,
      name: rawSignal.name,
      category: rawSignal.category,
      categoryRelation: rawSignal.categoryRelation,
      summary: rawSignal.summary,
      ...checkNovelty(rawSignal, signalObs.length, signalId, adjustments, register.queries),
      observationIds: signalObs.map((o) => o.id),
      culturalRelevance: { status: "unverified", maxScore: null, independentOrigins: 0, reason: "" },
      momentum: { status: "unverified", maxScore: null, independentOrigins: 0, reason: "" },
    });
  });

  sharePublicationDates(observations, adjustments);
  for (const o of observations) checkBehaviorAgainstPublication(o);
  for (const signal of signals) {
    const own = observations.filter((o) => o.signalId === signal.id);
    signal.culturalRelevance = relevanceEligibility(own, now);
    signal.momentum = momentumEligibility(own, now);
  }

  const brandFreeSearches = countBrandFree(register.queries, brand);
  const crossCategorySearches = countCrossCategory(register.queries, draft.searchPurposes, brand, draft.categoryTerms);
  if (register.queries.length > 0 && crossCategorySearches === 0) {
    adjustments.push("Discovery stayed within the brand's category: no recorded search looked beyond it.");
  }
  if (register.queries.length > 0 && brandFreeSearches < MIN_BRAND_FREE_SEARCHES) {
    adjustments.push(
      `Discovery was brand-centric: only ${brandFreeSearches} of ${register.queries.length} searches looked beyond the brand (at least ${MIN_BRAND_FREE_SEARCHES} expected).`,
    );
  }

  return {
    version: 1,
    brand,
    platform,
    createdAt: now.toISOString(),
    queries: register.queries,
    searchErrors: register.searchErrors,
    sources: register.sources,
    citations: register.citations,
    signals,
    observations,
    inferences,
    gaps: draft.gaps,
    adjustments,
    discovery: { searches: register.queries.length, brandFreeSearches, crossCategorySearches, categoryTerms: draft.categoryTerms },
  };
}

export const MIN_BRAND_FREE_SEARCHES = 2;

const words = (q: string) => q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * Brand-free is not cross-category. A search counts as cross-category only if
 * the Scout labeled it so, it was actually run, and it names neither the
 * brand nor any category term the Scout listed. Whether those terms fully
 * describe the category is a semantic judgment code can't make.
 */
export function countCrossCategory(
  queries: string[],
  purposes: { query: string; purpose: string }[],
  brand: string,
  categoryTerms: string[],
): number {
  const brandKey = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  const terms = categoryTerms.flatMap(words).filter((t) => t.length > 2);
  const labeled = new Set(purposes.filter((p) => p.purpose === "cross-category").map((p) => words(p.query).join(" ")));
  return queries.filter((q) => {
    const w = words(q);
    if (!labeled.has(w.join(" "))) return false;
    if (brandKey && w.join("").includes(brandKey)) return false;
    return !w.some((x) => terms.some((t) => x === t || x.startsWith(t) || t.startsWith(x)));
  }).length;
}

/** Searches that don't name the brand (case- and spacing-insensitive). */
export function countBrandFree(queries: string[], brand: string): number {
  const key = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return queries.length;
  return queries.filter((q) => !q.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key)).length;
}

/** Observations whose quotes largely repeat each other share one origin. */
function mergeDuplicateOrigins(obs: LedgerObservation[], citationById: Map<string, CitationRecord>) {
  const text = (o: LedgerObservation) => o.citationIds.map((id) => citationById.get(id)!.quote).join(" ");
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      if (obs[i].originKey !== obs[j].originKey && nearDuplicate(text(obs[i]), text(obs[j]))) {
        const from = obs[j].originKey;
        const to = obs[i].originKey;
        for (const o of obs) if (o.originKey === from) o.originKey = to;
      }
    }
  }
}

const within = (o: LedgerObservation, days: number, now: Date) => {
  const age = ageInDays(o.behavior, now);
  return age !== null && age <= days;
};
const independent = (list: LedgerObservation[]) => new Set(list.filter((o) => !o.owned).map((o) => o.originKey));

/** Cultural Relevance: is it happening now? Needs independent, dated presence. */
export function relevanceEligibility(obs: LedgerObservation[], now: Date): CriterionEligibility {
  const dated = obs.filter((o) => within(o, RELEVANCE_WINDOW_DAYS, now));
  const n = independent(dated).size;
  if (n >= 3) return { status: "eligible", maxScore: 5, independentOrigins: n, reason: `${n} independent origins dated within ${RELEVANCE_WINDOW_DAYS} days.` };
  if (n === 2) return { status: "eligible", maxScore: 4, independentOrigins: n, reason: `2 independent origins dated within ${RELEVANCE_WINDOW_DAYS} days (minimum evidence, capped at 4).` };
  return {
    status: "unverified",
    maxScore: null,
    independentOrigins: n,
    reason:
      n === 0
        ? `No independent origin with a reliably dated observation in the last ${RELEVANCE_WINDOW_DAYS} days.`
        : `Only 1 independent origin with a reliably dated observation in the last ${RELEVANCE_WINDOW_DAYS} days.`,
  };
}

/** Emerging Momentum: is it accelerating? Needs a quoted, dated increase plus independent support. */
export function momentumEligibility(obs: LedgerObservation[], now: Date): CriterionEligibility {
  const growth = obs.filter((o) => o.kind === "growth" && within(o, MOMENTUM_WINDOW_DAYS, now));
  if (growth.length === 0) {
    return { status: "unverified", maxScore: null, independentOrigins: 0, reason: `No evidence of acceleration: no quoted, reliably dated increase in the last ${MOMENTUM_WINDOW_DAYS} days.` };
  }
  const growthIndependent = independent(growth);
  const growthOrigins = [...new Set(growth.map((o) => o.originKey))];
  const datedIndependent = [...independent(obs.filter((o) => within(o, RELEVANCE_WINDOW_DAYS, now)))];
  // Support must come from an independent origin other than the one reporting the increase.
  const supported = growthOrigins.some((g) => datedIndependent.some((k) => k !== g));
  const n = new Set([...growthIndependent, ...datedIndependent]).size;
  if (growthIndependent.size >= 2) {
    return { status: "eligible", maxScore: 5, independentOrigins: n, reason: `${growthIndependent.size} independent origins report a dated increase.` };
  }
  if (supported) {
    return { status: "eligible", maxScore: 4, independentOrigins: n, reason: "One dated increase plus independent support (minimum evidence, capped at 4)." };
  }
  return { status: "unverified", maxScore: null, independentOrigins: n, reason: "A dated increase was reported, but no independent origin supports it." };
}

/* ---------- Dates: publication vs. behavior ---------- */

const PUBLICATION_CUE = /\b(published|posted|updated|first appeared|dated|written|byline|story by)\b/i;
const NON_PUBLICATION_CUE = /\b(as of|measured|counts?|figures?|data|statistics|followers?|views?|ranked|tracked|sample)\b/i;

/**
 * A quote supports a publication date only if it says so ("Published…",
 * "Posted on…") or is just a dateline (the date and little else). A date
 * attached to a measurement, example or page element ("Follower counts are
 * as of November 5") is never a publication date.
 */
export function looksLikePublicationDate(quote: string, dateText: string): boolean {
  const rest = squash(quote).replace(squash(dateText), " ").replace(/[^a-z]+/g, " ").trim();
  if (PUBLICATION_CUE.test(quote)) return true;
  if (NON_PUBLICATION_CUE.test(quote)) return false;
  return rest.split(" ").filter(Boolean).length <= 3; // a bare dateline, e.g. "Nov 5, 2026 —"
}

/**
 * Split the Scout's one date per observation into the two kinds we keep apart.
 * A "published" date (or an unlabeled one) never becomes the behavior's date.
 */
function dates(
  dateText: string,
  dateBasis: "published" | "behavior" | "other" | "none",
  citationIds: string[],
  citationById: Map<string, CitationRecord>,
  now: Date,
  adjustments: string[],
): { behavior: Timeframe; published: PublishedDate | null } {
  const quotes = citationIds.map((id) => citationById.get(id)!.quote);
  const noBehavior: Timeframe = { status: "unknown", reason: "No cited text says when the behavior happened." };
  if (!dateText.trim()) return { behavior: noBehavior, published: null };

  const resolved = resolveTimeframe(dateText, quotes, now);
  if (dateBasis === "behavior") return { behavior: resolved, published: null };
  // "other" (measurement, example, page element) and unlabeled dates are neither kind.
  if (dateBasis !== "published" || resolved.status !== "known") return { behavior: noBehavior, published: null };
  const holder = citationIds.map((id) => citationById.get(id)!).find((c) => squash(c.quote).includes(squash(resolved.dateText)))!;
  if (!looksLikePublicationDate(holder.quote, resolved.dateText)) {
    adjustments.push(`"${resolved.dateText}" is attached to a measurement, example or page element, not a publication date, so it wasn't used as one.`);
    return { behavior: noBehavior, published: null };
  }
  return {
    behavior: noBehavior,
    published: { date: resolved.date, precision: resolved.precision, dateText: resolved.dateText, sourceId: holder.sourceId, shared: false },
  };
}

/**
 * A verified publication date applies to every observation quoting the same
 * article. If an article shows conflicting dates, none is shared.
 */
export function sharePublicationDates(observations: LedgerObservation[], adjustments: string[]) {
  const bySource = new Map<string, PublishedDate[]>();
  for (const o of observations) {
    if (o.published && !o.published.shared) bySource.set(o.published.sourceId, [...(bySource.get(o.published.sourceId) ?? []), o.published]);
  }
  const unique = new Map<string, PublishedDate>();
  for (const [sourceId, list] of bySource) {
    const distinct = new Set(list.map((d) => d.date));
    if (distinct.size === 1) unique.set(sourceId, list[0]);
    else adjustments.push(`${sourceId} shows conflicting publication dates (${[...distinct].join(", ")}), so none was shared.`);
  }
  for (const o of observations) {
    if (o.published) continue;
    const found = o.sourceIds.map((id) => unique.get(id)).filter(Boolean) as PublishedDate[];
    if (found.length > 0 && new Set(found.map((d) => d.date)).size === 1) o.published = { ...found[0], shared: true };
  }
}

/** A behavior can't be dated after the article describing it was published. */
function checkBehaviorAgainstPublication(o: LedgerObservation) {
  if (o.behavior.status !== "known" || !o.published) return;
  const behaviorStart = startOf(o.behavior.date);
  const publishedEnd = startOf(o.published.date) + (o.published.precision === "month" ? 31 : 1) * DAY_MS;
  if (behaviorStart > publishedEnd) {
    o.behavior = { status: "unknown", reason: `The behavior date (${o.behavior.dateText}) is after the article's publication date.` };
  }
}

/* ---------- Novelty and lineage (the Scout's assessment, lightly checked) ---------- */

const NONE = /^(none( identified)?|n\/a|unknown|uncertain|not identified|)$/i;
const normalizeQuery = (q: string) => q.toLowerCase().replace(/["“”]/g, "").replace(/\s+/g, " ").trim();

/**
 * Code can't judge whether a label is right, but it can catch labels that
 * contradict their own reasoning. Each rule generalizes to unfamiliar
 * patterns; none names a specific expression.
 *  - A lineage check counts only if the Scout names a search that the API
 *    actually recorded (structured data, not the wording of its notes).
 *  - emerging: needs a stated new mechanism, a lineage check and a cited
 *    observation. Named influences or a parent are allowed: what matters is
 *    whether the mechanism itself is meaningfully different.
 *  - evolving: needs a named parent template and what changed.
 *  - derivative: needs a named parent template.
 * A label that fails becomes "uncertain"; the signal itself is always kept.
 */
export function checkNovelty(
  raw: { novelty: Novelty; whatIsNew: string; lookback: string; lineage: string; creativeOpportunity: string; lineageQuery: string },
  citedObservations: number,
  signalId: string,
  adjustments: string[],
  recordedQueries: string[],
): Pick<LedgerSignal, "novelty" | "lineage" | "whatIsNew" | "lookback" | "noveltyChecked" | "lineageQuery" | "creativeOpportunity"> {
  const lineage = NONE.test(raw.lineage.trim()) ? null : raw.lineage.trim();
  const whatIsNew = raw.whatIsNew.trim();
  const lookback = raw.lookback.trim() || "Not checked";
  const named = normalizeQuery(raw.lineageQuery);
  const recorded = named ? recordedQueries.find((q) => normalizeQuery(q) === named) ?? null : null;
  if (named && !recorded) adjustments.push(`${signalId}: the lineage search it names wasn't among the searches actually run.`);
  const noveltyChecked = recorded !== null;
  const base = { lineage, whatIsNew, lookback, noveltyChecked, lineageQuery: recorded, creativeOpportunity: raw.creativeOpportunity.trim() };
  const uncertain = (why: string) => {
    adjustments.push(`${signalId}: labeled ${raw.novelty} but ${why}, so novelty is uncertain.`);
    return { ...base, novelty: "uncertain" as const };
  };

  if (raw.novelty === "emerging") {
    if (!whatIsNew) return uncertain("it doesn't say what is new about the mechanism");
    if (!noveltyChecked) return uncertain("no recorded lineage search backs it");
    if (citedObservations === 0) return uncertain("no cited observation supports it");
  }
  if (raw.novelty === "evolving") {
    if (!lineage) return uncertain("it names no established template it evolved from");
    if (!whatIsNew) return uncertain("it doesn't say what changed");
    if (citedObservations === 0) return uncertain("no cited observation supports it");
  }
  if (raw.novelty === "derivative" && !lineage) return uncertain("it names no template it derives from");
  return { ...base, novelty: raw.novelty };
}
