import { checkGrounding, ideaKind, PROVEN_WINDOW_DAYS, provenKind } from "../evaluation/evidence.ts";
import { checkDiversity, type DiversityReport } from "../evaluation/diversity.ts";
import {
  decideRevision,
  rankCandidates,
  rankValue,
  type CandidateInput,
  type CandidateScore,
  type CriterionId,
  type CriterionResult,
  type RevisionChecks,
  type RevisionDecision,
} from "../evaluation/scoring.ts";
import { repeatOf, type RecentIdea } from "../prompts/recent-ideas.ts";
import {
  checkLedger,
  domainOf,
  independentOrigins,
  looksLikeInjection,
  MAX_SIGNALS,
  namesBrandOrCategory,
  normalizeUrl,
  type CitationRecord,
  type EvidenceLedger,
  type LedgerDraft,
  type RawCitation,
  type SourceRecord,
} from "../research/ledger.ts";
import type { CandidateDraft, LonglistIdeaDraft } from "../spark-schema.ts";
import type { Candidate, Platform } from "../types.ts";

/**
 * The agent's workspace: its evidence board and idea wall, kept by code.
 *
 * The agent writes into it only through tools, and every write is checked
 * here. Everything that decides an outcome (which sources exist, how fresh a
 * signal is, which idea wins) is computed by code from this record, never
 * taken from the agent's word. Pure: no model calls, no I/O.
 */

export interface Brief {
  brand: string;
  platform: Platform;
  audience?: string;
  recentIdeas: RecentIdea[];
}

/** Day 6: "audience" and "moment" split the old "cross-category"; "cross-category" is still accepted from older callers and counts as audience. */
export type SearchPurpose = "brand" | "category" | "audience" | "moment" | "cross-category" | "depth";

/** Which way a search looked, for the research map. */
const MAP_LABELS = { brand: "brand", category: "category", audience: "audience culture", moment: "wider-culture moments", depth: "depth" } as const;
export type SignalDraft = LedgerDraft["signals"][number];

export interface WallIdea extends LonglistIdeaDraft {
  id: string; // L1, L2…
  /** The latest quick gut-check, if any. Guidance only: never part of the Spark Score. */
  gutCheck?: { stopPower: number; shareability: number; note: string };
}

/** One developed treatment. A revision is a new version linked to its original. */
export interface Developed {
  candidate: Candidate;
  ideaId: string;
  /** The agent's stated reason for developing it (shown with the idea wall). */
  why?: string;
  /** Day 6: the route the agent bet on, and its reach thesis (a hypothesis). */
  route?: Route;
  reach?: ReachThesis;
  /** Set on a revision: the version it revises. */
  revises: string | null;
  /** The evaluator's verdict, once it has one. */
  assessment: Assessment | null;
}

export interface Assessment {
  evaluatorLabel: string;
  results: CriterionResult[];
  meaningfulAudioVariations: number;
  makeable: boolean;
  makeableNote: string;
  /** Which evaluation round (1, 2) or "rescore". */
  round: number | "rescore";
}

export interface RevisionRecord {
  originalId: string;
  revisedId: string;
  weakness: string;
  /** The criterion the agent said the weakness affects. */
  affectedCriterion: CriterionId;
  /** The agent's stated reason for revising. */
  why: string;
  whatChanged: string;
  checks: RevisionChecks;
  checksRationale: string;
  decision: RevisionDecision;
}

export interface Ending {
  how: "finished" | "abstained" | "stopped";
  /** Code's account of why the run ended. */
  reason: string;
  /** The agent's tie-break judgment, when it decided an exact tie. */
  tieJudgment: { chosenId: string; tiedWith: string[]; note: string } | null;
  /** The agent's stated reason for revising the leader or not (Day 6). */
  revisionDecision: string | null;
  /** Open shape: what else the agent considered and why the winner beats it, in its words. */
  comparison: string | null;
  /** Which route the winner takes and why that route beat the others, in the agent's words. */
  routeDecision: string | null;
}

/** A working bet about what will resonate (Day 6, round 2). Code tracks its status; the agent settles it with evidence. */
export interface Hypothesis {
  id: string; // H1, H2…
  statement: string;
  status: "open" | "supported" | "refuted" | "dropped";
  /** Evidence IDs (G…, C…, S…) cited when it was settled. Checked by code. */
  evidence: string[];
  note: string;
}

export const MAX_HYPOTHESES = 6;

export const MAX_LONGLIST = 20;
/** Day 6: the two routes to organic views, plus an original format not built on any trend. */
export type Route = "proven" | "primed" | "original";

/** Why an idea should earn views, and what would prove the bet wrong. A hypothesis, never a forecast. */
export interface ReachThesis {
  behaviors: string;
  wouldProveWrong: string;
}

/** Agent mode ranks route-neutrally: no head start for any kind of idea (approved Day 6). */
export const AGENT_HEAD_START = 0;

/** Day 6, open shape: how many ideas one review may score. */
export const MAX_REVIEW_BATCH = 3;

/**
 * Which trend routes a signal can carry, under the same rules code applies
 * when it flags rejections: fresh carries primed or proven; dated by behavior
 * or publication within 90 days carries proven; anything else is context only.
 */
export function routesSupported(f: { status: string; ageDays: number | null; basis?: string | null }): "primed-and-proven" | "proven" | "context" {
  if (f.status === "fresh") return "primed-and-proven";
  if (f.ageDays != null && f.ageDays <= PROVEN_WINDOW_DAYS && (f.basis === "behavior" || f.basis === "published")) return "proven";
  return "context";
}

export class Workspace {
  readonly brief: Brief;
  private readonly now: () => Date;
  private readonly idPrefix: string;

  /* ---------- Evidence board ---------- */
  readonly queries: string[] = [];
  readonly searchErrors: string[] = [];
  /** inCategory: for a "moment" search, the brand or category word it named (Day 6), so it doesn't count as the wider culture. */
  readonly searchPurposes: { query: string; purpose: SearchPurpose; inCategory?: string | null }[] = [];
  readonly sources: SourceRecord[] = [];
  private readonly allCitations: CitationRecord[] = [];
  private readonly registerAdjustments: string[] = [];
  readonly signalDrafts: SignalDraft[] = [];
  readonly categoryTerms: string[] = [];
  /** The agent's own tag for what a signal is evidence of (Day 6). Its stated view; code shows it, never trusts it for scoring. */
  readonly signalRoles = new Map<string, "performing" | "emerging">();
  private cachedLedger: EvidenceLedger | null = null;

  /* ---------- Idea wall ---------- */
  readonly wall: WallIdea[] = [];
  /** Every version ever developed, by candidate ID. */
  readonly developed = new Map<string, Developed>();
  readonly revisions: RevisionRecord[] = [];
  ending: Ending | null = null;
  /** Range (Day 6): set once code has challenged a finish with a single, unchallenged reviewed idea. */
  soloChallenged = false;
  private developedCount = 0;

  constructor(brief: Brief, options: { now?: () => Date; idPrefix?: string } = {}) {
    this.brief = brief;
    this.now = options.now ?? (() => new Date());
    this.idPrefix = options.idPrefix ?? "cand";
  }

  /* ================= Evidence ================= */

  /**
   * File one search's results, straight from the API's own blocks. Only pages
   * the search returned become sources; IDs never change once given.
   */
  addSearch(input: {
    query: string;
    purpose: SearchPurpose;
    results: { url: string; title: string; pageAge: string | null }[];
    citations: RawCitation[];
    errorCode?: string | null;
  }): { newSources: SourceRecord[]; newCitations: CitationRecord[]; adjustments: string[] } {
    this.queries.push(input.query);
    this.searchPurposes.push({
      query: input.query,
      purpose: input.purpose,
      ...(input.purpose === "moment" ? { inCategory: namesBrandOrCategory(input.query, this.brief.brand, this.categoryTerms) } : {}),
    });
    if (input.errorCode) this.searchErrors.push(input.errorCode);
    const newSources: SourceRecord[] = [];
    for (const r of input.results) {
      if (!domainOf(r.url) || this.sourceByUrl(r.url)) continue;
      const record: SourceRecord = {
        id: `S${this.sources.length + 1}`,
        url: r.url,
        domain: domainOf(r.url),
        title: r.title,
        pageUpdated: r.pageAge,
        query: input.query,
        setAside: looksLikeInjection(r.title),
      };
      this.sources.push(record);
      newSources.push(record);
    }
    const titleNotes = newSources
      .filter((x) => x.setAside)
      .map((x) => `Set aside ${x.domain}: it contains instructions aimed at AI systems, so it isn't used as evidence.`);
    this.registerAdjustments.push(...titleNotes);
    const added = this.addCitations(input.citations);
    this.cachedLedger = null;
    return { newSources, newCitations: added.citations, adjustments: [...titleNotes, ...added.adjustments] };
  }

  /** File quotes from a page already in the register (a search's citations, or a page read). */
  addCitations(raw: RawCitation[]): { citations: CitationRecord[]; adjustments: string[] } {
    const citations: CitationRecord[] = [];
    const adjustments: string[] = [];
    for (const c of raw) {
      const source = this.sourceByUrl(c.url);
      if (!source) {
        adjustments.push(`Dropped a citation to a page the search didn't return (${domainOf(c.url) || "unknown site"}).`);
        continue;
      }
      const quote = c.citedText.trim();
      if (!quote) continue;
      if (looksLikeInjection(quote) && !source.setAside) {
        source.setAside = true;
        adjustments.push(`Set aside ${source.domain}: it contains instructions aimed at AI systems, so it isn't used as evidence.`);
      }
      if (this.allCitations.some((x) => x.sourceId === source.id && x.quote === quote)) continue;
      const record: CitationRecord = { id: `C${this.allCitations.length + 1}`, sourceId: source.id, quote };
      this.allCitations.push(record);
      citations.push(record);
    }
    this.registerAdjustments.push(...adjustments);
    this.cachedLedger = null;
    return { citations: citations.filter((c) => !this.sourceById(c.sourceId)?.setAside), adjustments };
  }

  /** Quotes that can support evidence: never from a page set aside for prompt injection. */
  usableCitations(): CitationRecord[] {
    return this.allCitations.filter((c) => !this.sourceById(c.sourceId)?.setAside);
  }

  sourceById(id: string): SourceRecord | undefined {
    return this.sources.find((s) => s.id === id);
  }

  private sourceByUrl(url: string): SourceRecord | undefined {
    const key = normalizeUrl(url);
    return this.sources.find((s) => normalizeUrl(s.url) === key);
  }

  /** File a signal. Returns the problem if it can't be filed. */
  addSignal(draft: SignalDraft, categoryTerms: string[] = []): { ok: true; signalId: string } | { ok: false; problem: string } {
    if (this.signalDrafts.length >= MAX_SIGNALS) return { ok: false, problem: `The evidence board is full (${MAX_SIGNALS} signals).` };
    if (this.queries.length === 0) return { ok: false, problem: "No searches have run yet, so there's nothing to cite." };
    this.signalDrafts.push(draft);
    this.addCategoryTerms(categoryTerms);
    this.cachedLedger = null;
    return { ok: true, signalId: `G${this.signalDrafts.length}` };
  }

  /** Words naming the brand's own category, from the agent. Used to check that discovery searches leave the category. */
  addCategoryTerms(terms: string[]): void {
    for (const t of terms.map((x) => x.trim()).filter(Boolean)) {
      if (!this.categoryTerms.includes(t) && this.categoryTerms.length < 12) this.categoryTerms.push(t);
    }
    this.cachedLedger = null;
  }

  /** Moment searches that actually left the brand and its category. */
  wideMomentSearches(): number {
    return this.searchPurposes.filter((p) => p.purpose === "moment" && !p.inCategory).length;
  }

  /** The checked ledger: the same rules as the fixed pipeline's (`checkLedger`). Null before any search. */
  ledger(): EvidenceLedger | null {
    if (this.queries.length === 0) return null;
    this.cachedLedger ??= checkLedger({
      brand: this.brief.brand,
      platform: this.brief.platform,
      now: this.now(),
      draft: {
        signals: this.signalDrafts,
        gaps: [],
        categoryTerms: this.categoryTerms,
        searchPurposes: this.searchPurposes.map((p) => ({
          query: p.query,
          purpose: p.purpose === "audience" || p.purpose === "moment" ? ("cross-category" as const) : p.purpose,
        })),
      },
      register: {
        sources: this.sources,
        citations: this.usableCitations(),
        queries: this.queries,
        searchErrors: this.searchErrors,
        adjustments: this.registerAdjustments,
      },
    });
    return this.cachedLedger;
  }

  /** Code's report on the evidence: facts only, no AI opinion. */
  evidenceReport() {
    const ledger = this.ledger();
    const signals = (ledger?.signals ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      relation: s.categoryRelation,
      observations: s.observationIds.length,
      freshness: s.freshness.status,
      ageDays: s.freshness.ageDays,
      /** What the freshness rests on: a behavior or publication date, or only a page-update date (the weakest). */
      dateBasis: s.freshness.basis,
      /** A cited source describes growth or spread (an observation of kind "growth"). */
      growthReported: ledger!.observations.some((o) => o.signalId === s.id && o.kind === "growth"),
      role: this.signalRoles.get(s.id) ?? null,
      independentOrigins: independentOrigins(ledger!.observations.filter((o) => o.signalId === s.id)),
      relevanceBar: s.culturalRelevance.status,
      /** Which trend routes this signal can carry under code's rules (Day 6). */
      supports: routesSupported(s.freshness),
    }));
    const gaps: string[] = [];
    if (this.queries.length === 0) gaps.push("No research yet.");
    else if (signals.length === 0) gaps.push("No signals filed yet: nothing from the searches counts as evidence until it's filed with quotes.");
    if (signals.length > 0 && !signals.some((s) => s.freshness === "fresh")) {
      gaps.push(
        signals.some((s) => s.supports === "proven")
          ? "No fresh signal: nothing is dated within the last 30 days, so a primed idea would be rejected. A proven idea can still build on a signal dated by behavior or publication within 90 days; otherwise search for newer evidence or develop original formats."
          : "No fresh signal, and nothing dated by behavior or publication within 90 days: a primed or proven idea would be rejected as stale. Search for newer evidence or develop original formats.",
      );
    }
    const stayedIn = this.searchPurposes.filter((p) => p.purpose === "moment" && p.inCategory);
    if (this.queries.length > 0 && this.wideMomentSearches() === 0 && stayedIn.length) {
      gaps.push(
        `Your moment search${stayedIn.length === 1 ? "" : "es"} named the brand or its category (${[...new Set(stayedIn.map((p) => `"${p.inCategory}"`))].join(", ")}), so ${stayedIn.length === 1 ? "it" : "they"} stayed inside the niche. The wider culture is still unexplored: what everyone is watching, playing, following or counting down to, whatever their category. Whether a collision fits this brief is your call.`,
      );
    } else if (this.queries.length > 0 && this.wideMomentSearches() === 0) {
      gaps.push(
        "Nothing searched beyond this brand, its category and its audience yet. The wider culture (what everyone is watching, playing, following or counting down to right now: releases, launches, sports, news, internet-wide moments) is unexplored. Ideas that collide with a moment like that can travel far beyond the niche; whether one fits this brief is your call.",
      );
    }
    for (const s of signals) {
      if (s.observations === 0) gaps.push(`${s.id} has no quoted observations, so it can't support an idea directly.`);
      else if (s.independentOrigins < 2) gaps.push(`${s.id} rests on a single source.`);
    }
    return {
      searches: this.queries.length,
      sources: this.sources.length,
      usableQuotes: this.usableCitations().length,
      signals,
      freshSignals: signals.filter((s) => s.freshness === "fresh").map((s) => s.id),
      gaps,
      notes: (ledger?.adjustments ?? []).slice(-8),
    };
  }

  /**
   * One line on evidence quality, for code's readout after every action
   * (Day 6). Facts only: freshness, what the date rests on, and how many
   * independent sources each signal has. Null before any research.
   */
  /** Day 6: where the research has looked so far, by search purpose. Null before any research. */
  researchMap(): string | null {
    if (this.queries.length === 0) return null;
    const counts = { brand: 0, category: 0, audience: 0, moment: 0, depth: 0 };
    let stayedIn = 0;
    for (const p of this.searchPurposes) {
      // A "moment" search that names the brand or category looked inside the niche; code counts it as category.
      if (p.purpose === "moment" && p.inCategory) {
        counts.category++;
        stayedIn++;
      } else counts[p.purpose === "cross-category" ? "audience" : p.purpose]++;
    }
    const parts = (Object.keys(counts) as (keyof typeof counts)[]).map((k) => `${MAP_LABELS[k]} ${counts[k]}`);
    const note = stayedIn ? ` ${stayedIn} search(es) labeled moment named the brand or its category, so code counted them as category.` : "";
    return `Research map (searches by where they looked): ${parts.join(" · ")}.${note}${counts.moment === 0 ? " The wider culture is unexplored." : ""}`;
  }

  evidenceLine(): string | null {
    const SUPPORTS = { "primed-and-proven": "can carry primed or proven", proven: "can carry proven only", context: "context only" } as const;
    if (this.queries.length === 0) return null;
    const { signals } = this.evidenceReport();
    if (signals.length === 0) return "Evidence quality: nothing filed yet, so no idea has evidence behind it.";
    const BASIS = { behavior: "behavior date", published: "publication date", "page-updated": "page update only" } as const;
    const parts = signals.map((s) => {
      const fresh = s.freshness === "fresh" ? `fresh, ${s.ageDays} days` : s.freshness;
      const basis = s.dateBasis ? `, ${BASIS[s.dateBasis]}` : "";
      const growth = s.growthReported ? ", growth reported" : "";
      const role = s.role ? `, tagged ${s.role}` : "";
      return `${s.id} ${fresh}${basis}, ${s.independentOrigins} independent source${s.independentOrigins === 1 ? "" : "s"}${growth}${role}, ${SUPPORTS[s.supports]}`;
    });
    const thin = signals.filter((s) => s.freshness === "fresh" && (s.independentOrigins < 2 || s.dateBasis === "page-updated")).map((s) => s.id);
    return `Evidence quality: ${parts.join("; ")}.${thin.length ? ` Thin (one source, or dated only by a page update): ${thin.join(", ")}.` : ""}`;
  }

  /* ================= Hypotheses ================= */

  readonly hypotheses: Hypothesis[] = [];

  addHypotheses(statements: string[]): { added: Hypothesis[]; problem: string | null } {
    const clean = statements.map((s) => s.trim()).filter(Boolean);
    const room = MAX_HYPOTHESES - this.hypotheses.length;
    if (room <= 0) return { added: [], problem: `There are already ${MAX_HYPOTHESES} hypotheses. Settle or drop one first.` };
    const added = clean.slice(0, room).map((statement) => {
      const h: Hypothesis = { id: `H${this.hypotheses.length + 1}`, statement, status: "open", evidence: [], note: "" };
      this.hypotheses.push(h);
      return h;
    });
    return { added, problem: clean.length > room ? `Only ${room} more hypothesis(es) fit; the rest were not added.` : null };
  }

  /** Settle a bet. Supported or refuted needs at least one real evidence ID; dropped needs only a note. */
  settleHypothesis(
    id: string,
    verdict: "supported" | "refuted" | "dropped",
    evidence: string[],
    note: string,
  ): { ok: true; hypothesis: Hypothesis; previous: Hypothesis["status"] } | { ok: false; problem: string } {
    const h = this.hypotheses.find((x) => x.id === id.trim());
    if (!h) return { ok: false, problem: `Unknown hypothesis ${id}.` };
    const ledger = this.ledger();
    const known = new Set([
      ...(ledger?.signals.map((s) => s.id) ?? []),
      ...this.usableCitations().map((c) => c.id),
      ...this.sources.map((s) => s.id),
    ]);
    const ids = [...new Set(evidence.map((e) => e.trim()).filter(Boolean))];
    const unknown = ids.filter((e) => !known.has(e));
    if (unknown.length) return { ok: false, problem: `Unknown evidence ID(s): ${unknown.join(", ")}. Cite signals (G…), quotes (C…) or sources (S…) from this scan.` };
    if (verdict !== "dropped" && ids.length === 0) return { ok: false, problem: `To mark ${h.id} ${verdict}, cite at least one piece of evidence (G…, C… or S…).` };
    if (!note.trim()) return { ok: false, problem: "Say in a sentence what settled it." };
    const previous = h.status;
    h.status = verdict;
    h.evidence = ids;
    h.note = note.trim();
    return { ok: true, hypothesis: h, previous };
  }

  /* ================= Ideas ================= */

  addIdeas(ideas: LonglistIdeaDraft[]): { added: WallIdea[]; problem: string | null } {
    const room = MAX_LONGLIST - this.wall.length;
    if (room <= 0) return { added: [], problem: `The longlist is full (${MAX_LONGLIST} ideas).` };
    const known = new Set((this.ledger()?.signals ?? []).map((s) => s.id));
    const added = ideas.slice(0, room).map((idea) => {
      const entry: WallIdea = {
        ...idea,
        id: `L${this.wall.length + 1}`,
        // Original formats aren't built on a trend; only real signal IDs are kept.
        groundedIn: idea.basis === "original" ? [] : idea.groundedIn.filter((id) => known.has(id)),
      };
      this.wall.push(entry);
      return entry;
    });
    const problem = ideas.length > room ? `Only ${room} more idea(s) fit; the rest were not added.` : null;
    return { added, problem };
  }

  /**
   * Develop any idea on the wall in full. Returns code's flags: grounding
   * problems, whether it counts as a fresh trend, an original or a stale
   * trend (rejected), and whether it repeats something this person has seen.
   */
  develop(
    ideaId: string,
    draft: CandidateDraft,
    why = "",
    bet: { route?: Route; reach?: ReachThesis } = {},
  ): { ok: true; candidate: Candidate; flags: string[] } | { ok: false; problem: string } {
    if (!this.wall.some((w) => w.id === ideaId)) {
      return { ok: false, problem: `${ideaId} isn't on your idea wall. Note it with add_ideas first${this.wall.length ? ` (on the wall: ${this.wall.map((w) => w.id).join(", ")})` : ""}.` };
    }
    const current = this.currentVersion(ideaId);
    if (current?.assessment) {
      return { ok: false, problem: `${ideaId} has already been evaluated. Use revise to improve it.` };
    }
    const ledger = this.ledger();
    const grounding = checkGrounding(draft, ledger);
    const id = current ? current.candidate.id : `${this.idPrefix}-${++this.developedCount}`;
    const candidate: Candidate = {
      id,
      ...draft,
      groundedIn: grounding.groundedIn,
      contextIn: grounding.contextIn,
      groundingWarnings: grounding.warnings,
    };
    const route = bet.route ?? current?.route ?? (draft.basis === "original" ? "original" : "primed");
    this.developed.set(id, { candidate, ideaId, why: why || current?.why, route, reach: bet.reach ?? current?.reach, revises: null, assessment: null });
    return { ok: true, candidate, flags: this.flagsFor(candidate, route) };
  }

  /** How code classifies an idea: by the route the agent chose and the dates of its evidence. */
  kindOf(candidate: Candidate, route?: Route): ReturnType<typeof ideaKind> {
    if (route === "proven") return provenKind(candidate, this.ledger());
    return ideaKind(candidate, this.ledger());
  }

  /** What code will hold against an idea when ranking: told to the agent up front. */
  flagsFor(candidate: Candidate, route?: Route): string[] {
    const flags = [...(candidate.groundingWarnings ?? [])];
    const kind = this.kindOf(candidate, route);
    if (kind === "stale-trend") {
      flags.push(
        route === "proven"
          ? `REJECTION RISK: a proven pattern needs at least one signal dated by behavior or publication within ${PROVEN_WINDOW_DAYS} days (or fresh). None of its signals qualifies, so it will be rejected unless re-grounded.`
          : "REJECTION RISK: built on a trend with no fresh evidence (none of its signals is dated within 30 days). It will be rejected as stale unless it's grounded in a fresh signal, treated as a proven pattern with evidence it's still performing, or reframed as an original format.",
      );
    } else if (kind === "original") {
      flags.push("Counts as an original format.");
    } else if (kind === "proven-pattern") {
      flags.push(`Counts as a proven pattern (evidence it's performing within ${PROVEN_WINDOW_DAYS} days).`);
    } else {
      flags.push("Counts as a fresh trend.");
    }
    const repeat = repeatOf(candidate, this.brief.recentIdeas);
    if (repeat) flags.push(`REJECTION RISK: repeats an idea this person was already shown ("${repeat.headline}").`);
    return flags;
  }

  /** The latest version of a developed idea: its kept revision if one won, else the original. */
  currentVersion(ideaId: string): Developed | null {
    const versions = [...this.developed.values()].filter((d) => d.ideaId === ideaId);
    const original = versions.find((d) => d.revises === null) ?? null;
    if (!original) return null;
    let current = original;
    for (;;) {
      const kept = this.revisions.find((r) => r.originalId === current.candidate.id && r.decision.outcome === "kept-revised");
      const next = kept ? this.developed.get(kept.revisedId) : undefined;
      if (!next) return current;
      current = next;
    }
  }

  /** Every developed idea, at its current version, in the order first developed. */
  finalists(): Developed[] {
    const ideaIds: string[] = [];
    for (const d of this.developed.values()) if (d.revises === null && !ideaIds.includes(d.ideaId)) ideaIds.push(d.ideaId);
    return ideaIds.map((id) => this.currentVersion(id)).filter((d): d is Developed => !!d);
  }

  /** Check the ideas the agent wants reviewed: 1 to 3 developed ideas, at their current version, not yet reviewed. */
  readyForEvaluation(candidateIds: string[]): { ok: true; finalists: Developed[] } | { ok: false; problem: string } {
    const ids = [...new Set(candidateIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length < 1 || ids.length > MAX_REVIEW_BATCH) return { ok: false, problem: `Send 1 to ${MAX_REVIEW_BATCH} developed ideas per review.` };
    const current = this.finalists();
    const chosen: Developed[] = [];
    for (const id of ids) {
      const d = current.find((x) => x.candidate.id === id);
      if (!d) {
        const known = current.map((x) => x.candidate.id).join(", ") || "none yet";
        return { ok: false, problem: `${id} isn't a developed idea at its current version (developed: ${known}).` };
      }
      if (d.assessment) return { ok: false, problem: `${id} has already been reviewed. Revise it or review something new.` };
      chosen.push(d);
    }
    return { ok: true, finalists: chosen };
  }

  /** Record the review panel's verdicts (from the paid evaluate tool). */
  recordAssessments(round: number, assessments: (Omit<Assessment, "round"> & { candidateId: string })[]): void {
    for (const a of assessments) {
      const d = this.developed.get(a.candidateId);
      if (d) d.assessment = { ...a, round };
    }
  }

  /** Ideas on the wall that can be gut-checked: 1 to 10 known IDs. */
  readyForGutCheck(ideaIds: string[]): { ok: true; ideas: WallIdea[] } | { ok: false; problem: string } {
    const ids = [...new Set(ideaIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length < 1 || ids.length > 10) return { ok: false, problem: "Gut-check 1 to 10 ideas from your wall at a time." };
    const ideas = ids.map((id) => this.wall.find((w) => w.id === id));
    const unknown = ids.filter((_, i) => !ideas[i]);
    if (unknown.length) return { ok: false, problem: `Not on your idea wall: ${unknown.join(", ")}.` };
    return { ok: true, ideas: ideas as WallIdea[] };
  }

  recordGutReads(ideas: WallIdea[], reads: { label: string; stopPower: number; shareability: number; note: string }[]): void {
    for (const r of reads) {
      const idea = ideas[Number(r.label) - 1];
      if (idea) idea.gutCheck = { stopPower: r.stopPower, shareability: r.shareability, note: r.note };
    }
  }

  /** Check a proposed revision before it's sent for a rescore. */
  prepareRevision(candidateId: string): { ok: true; original: Developed } | { ok: false; problem: string } {
    const original = this.developed.get(candidateId);
    if (!original) return { ok: false, problem: `Unknown candidate ${candidateId}.` };
    if (this.currentVersion(original.ideaId)?.candidate.id !== candidateId) {
      return { ok: false, problem: `${candidateId} isn't the current version of its idea; revise ${this.currentVersion(original.ideaId)?.candidate.id}.` };
    }
    if (!original.assessment) return { ok: false, problem: `${candidateId} hasn't been evaluated yet, so there's nothing to improve on.` };
    return { ok: true, original };
  }

  /** Record a rescored revision and let code's rule decide which version stands. */
  recordRevision(input: {
    originalId: string;
    draft: CandidateDraft;
    weakness: string;
    affectedCriterion?: CriterionId;
    why?: string;
    whatChanged: string;
    assessment: Omit<Assessment, "round">;
    checks: RevisionChecks;
    checksRationale: string;
  }): RevisionRecord {
    const original = this.developed.get(input.originalId)!;
    const ledger = this.ledger();
    // A revision keeps the original's evidence, as in the fixed pipeline.
    const grounding = checkGrounding({ ...input.draft, groundedIn: original.candidate.groundedIn, contextIn: original.candidate.contextIn }, ledger);
    const revisedId = `${input.originalId}-rev`;
    const revised: Candidate = {
      id: revisedId,
      ...input.draft,
      groundedIn: grounding.groundedIn,
      contextIn: grounding.contextIn,
      groundingWarnings: grounding.warnings,
    };
    this.developed.set(revisedId, {
      candidate: revised,
      ideaId: original.ideaId,
      why: original.why,
      // A revision that changes basis changes route with it: an original format can't be a proven or primed bet, and vice versa.
      route: input.draft.basis === "original" ? "original" : original.route === "original" ? "primed" : original.route,
      reach: original.reach,
      revises: input.originalId,
      assessment: { ...input.assessment, round: "rescore" },
    });
    const decision = decideRevision(this.scoreOf(original), this.scoreOf(this.developed.get(revisedId)!), input.checks);
    const record: RevisionRecord = {
      originalId: input.originalId,
      revisedId,
      weakness: input.weakness,
      affectedCriterion: input.affectedCriterion ?? "stopPower",
      why: input.why ?? "",
      whatChanged: input.whatChanged,
      checks: input.checks,
      checksRationale: input.checksRationale,
      decision,
    };
    this.revisions.push(record);
    return record;
  }

  /* ================= Scoring (code only) ================= */

  private inputFor(d: Developed, index: number): CandidateInput {
    const a = d.assessment!;
    return {
      candidateId: d.candidate.id,
      generationIndex: index,
      results: a.results,
      audioRole: d.candidate.audioRole,
      meaningfulAudioVariations: a.meaningfulAudioVariations,
      kind: this.kindOf(d.candidate, d.route),
      makeable: a.makeable,
      repeatOf: repeatOf(d.candidate, this.brief.recentIdeas),
    };
  }

  /** Code's score for one evaluated version. */
  scoreOf(d: Developed): CandidateScore {
    return rankCandidates([this.inputFor(d, 0)], { headStart: AGENT_HEAD_START }).scores[0];
  }

  /** Code's ranking of any evaluated versions, in the order given for tie-breaks. */
  rankVersions(versions: Developed[]) {
    const evaluated = versions.filter((d) => d.assessment);
    return rankCandidates(evaluated.map((d, i) => this.inputFor(d, i)), { headStart: AGENT_HEAD_START });
  }

  /** The first version developed for an idea (before any revision). */
  originalOf(ideaId: string): Developed | null {
    return [...this.developed.values()].find((d) => d.ideaId === ideaId && d.revises === null) ?? null;
  }

  /** Code's ranking of every reviewed idea (current versions), in the order developed for tie-breaks. Route-neutral. */
  ranking() {
    const evaluated = this.finalists().filter((d): d is Developed => !!d?.assessment);
    return rankCandidates(evaluated.map((d, i) => this.inputFor(d, i)), { headStart: AGENT_HEAD_START });
  }

  /**
   * After a review: the leader's weakest criteria (scored 3 or below), so the
   * agent can weigh a revision. Facts from the panel's scores only.
   */
  leaderWeaknesses(): { candidateId: string; weakest: { criterion: string; score: number; rationale: string }[] } | null {
    const { leaderId } = this.ranking();
    const leader = leaderId ? this.developed.get(leaderId) : null;
    if (!leader?.assessment) return null;
    const weakest = leader.assessment.results
      .filter((r) => r.score !== null && r.score <= 3)
      .sort((a, b) => a.score! - b.score!)
      .map((r) => ({ criterion: r.criterionId, score: r.score!, rationale: r.rationale }));
    return { candidateId: leader.candidate.id, weakest };
  }

  /** Finalists tied with the leader on whole-point ranking value. Empty when there's no tie. */
  tiedWithLeader(): string[] {
    const { scores } = this.ranking();
    const ranked = scores.filter((s) => !s.rejected);
    if (ranked.length < 2) return [];
    const top = Math.round(rankValue(ranked[0], AGENT_HEAD_START));
    const tied = ranked.filter((s) => Math.round(rankValue(s, AGENT_HEAD_START)) === top).map((s) => s.candidateId);
    return tied.length > 1 ? tied : [];
  }

  /**
   * Range (Day 6): how contested the lead is. The leader, how many reviewed
   * ideas it was ranked against, and the runner-up's gap. Facts from code's ranking.
   */
  contest(): { leaderId: string | null; leaderScore: number | null; reviewed: number; runnerUp: { candidateId: string; gap: number } | null } {
    const { leaderId, scores } = this.ranking();
    const lead = scores.find((s) => s.candidateId === leaderId) ?? null;
    const next = scores.find((s) => s.candidateId !== leaderId && !s.rejected) ?? scores.find((s) => s.candidateId !== leaderId) ?? null;
    return {
      leaderId,
      leaderScore: lead ? Math.round(lead.rankingScore) : null,
      reviewed: scores.length,
      runnerUp: lead && next ? { candidateId: next.candidateId, gap: Math.round(lead.rankingScore - next.rankingScore) } : null,
    };
  }

  diversity(): DiversityReport {
    return checkDiversity(this.finalists().filter((d) => d.assessment).map((d) => d.candidate), this.ledger());
  }

  /* ================= Ending ================= */

  /** What `finish` requires. Empty when the agent may finish. */
  finishProblems(): string[] {
    const problems: string[] = [];
    // Open shape (Day 6): the only quota is one developed idea the review panel has scored.
    if (!this.finalists().some((d) => d.assessment)) problems.push("Get at least one developed idea reviewed by the panel before finishing.");
    const open = this.hypotheses.filter((h) => h.status === "open").map((h) => h.id);
    if (open.length) problems.push(`Settle or drop your open hypotheses first (settle_hypothesis): ${open.join(", ")}.`);
    return problems;
  }

  /**
   * Pick the winner. Code ranks; the agent's choice counts only on an exact
   * whole-point tie at the top, and only among the tied ideas.
   */
  decideWinner(tiePick?: { candidateId: string; note: string }): { winnerId: string | null; tieJudgment: Ending["tieJudgment"] } {
    const ranking = this.ranking();
    const tied = this.tiedWithLeader();
    if (tiePick && tied.includes(tiePick.candidateId) && tiePick.note.trim()) {
      return {
        winnerId: tiePick.candidateId,
        tieJudgment: { chosenId: tiePick.candidateId, tiedWith: tied.filter((id) => id !== tiePick.candidateId), note: tiePick.note.trim() },
      };
    }
    return { winnerId: ranking.leaderId, tieJudgment: null };
  }

  end(ending: Ending): void {
    this.ending ??= ending;
  }
}
