import {
  ageInDays,
  numbersSupported,
  RELEVANCE_WINDOW_DAYS,
  type EvidenceLedger,
} from "../research/ledger.ts";
import type { CriterionResult, IdeaKind } from "./scoring.ts";

/**
 * Cultural Relevance, Day 5: the reviewer's 1–5 score always stands. It is
 * AI judgment, drawing on the research and the model's cultural knowledge.
 *
 * Code decides only whether the research also VERIFIES it, a label that never
 * changes the score. Verified means: a verified ledger; the idea is grounded
 * in a signal that cleared the ledger's relevance bar; and the reviewer cited
 * an observation from that signal with a behavior date in the relevance window.
 */

export interface RelevanceAssessment {
  /** 1–5, the reviewer's judgment. */
  score: number;
  rationale: string;
  /** Ledger observation IDs the judgment draws on, if any. */
  observationIds: string[];
  judgedFrom: "research" | "general-knowledge" | "both";
}

export function relevanceResult(
  assessment: RelevanceAssessment,
  ledger: EvidenceLedger | null,
  groundedIn: string[],
): CriterionResult {
  const base: CriterionResult = {
    criterionId: "culturalRelevance",
    status: "scored",
    score: assessment.score,
    rationale: assessment.rationale,
    judgedFrom: assessment.judgedFrom,
    observationIds: [],
    verified: false,
  };
  if (!ledger) return base;
  const signals = ledger.signals.filter((s) => groundedIn.includes(s.id));
  // Only real observations from this idea's own signals are kept as citations.
  const cited = ledger.observations.filter(
    (o) => assessment.observationIds.includes(o.id) && signals.some((s) => s.id === o.signalId),
  );
  const now = new Date(ledger.createdAt);
  const eligible = signals.filter(
    (s) => s.culturalRelevance.status === "eligible" && cited.some((o) => o.signalId === s.id),
  );
  const dated = cited.some((o) => {
    const age = ageInDays(o.behavior, now);
    return age !== null && age <= RELEVANCE_WINDOW_DAYS;
  });
  return { ...base, observationIds: cited.map((o) => o.id), verified: eligible.length > 0 && dated };
}

/**
 * What an idea rests on (Day 5). An original format is its own kind. A trend
 * idea counts as a fresh trend only if at least one signal it's grounded in
 * has fresh evidence; otherwise it's a stale trend, which is always rejected.
 */
export function ideaKind(
  candidate: { basis?: "trend" | "original"; groundedIn: string[] },
  ledger: EvidenceLedger | null,
): IdeaKind {
  if (candidate.basis === "original") return "original";
  const fresh = ledger?.signals.some((s) => candidate.groundedIn.includes(s.id) && s.freshness?.status === "fresh");
  return fresh ? "fresh-trend" : "stale-trend";
}

/**
 * Day 6 (agent mode, approved): a proven pattern is an established format
 * with reported evidence it's still performing. It qualifies when at least
 * one of its signals is fresh, or has a behavior or publication date within
 * PROVEN_WINDOW_DAYS. A page-update date alone isn't enough. Otherwise it's
 * a stale trend, rejected as before. Whether it's past its peak is the
 * review panel's judgment.
 */
export const PROVEN_WINDOW_DAYS = 90;

export function provenKind(candidate: { basis?: "trend" | "original"; groundedIn: string[] }, ledger: EvidenceLedger | null): IdeaKind {
  if (candidate.basis === "original") return "original";
  const ok = ledger?.signals.some(
    (s) =>
      candidate.groundedIn.includes(s.id) &&
      (s.freshness?.status === "fresh" ||
        (s.freshness?.ageDays != null && s.freshness.ageDays <= PROVEN_WINDOW_DAYS && (s.freshness.basis === "behavior" || s.freshness.basis === "published"))),
  );
  return ok ? "proven-pattern" : "stale-trend";
}

/** The freshest of an idea's own signals, for display. */
export function freshestSignal(groundedIn: string[], ledger: EvidenceLedger | null) {
  const own = (ledger?.signals ?? []).filter((s) => groundedIn.includes(s.id) && s.freshness?.ageDays != null);
  return own.sort((a, b) => a.freshness.ageDays! - b.freshness.ageDays!)[0] ?? null;
}

/** Signal IDs a candidate claims, kept only if they exist in the ledger. */
export function checkGrounding(
  candidate: { groundedIn: string[]; contextIn?: string[]; evidenceBasis: string; basis?: "trend" | "original" },
  ledger: EvidenceLedger | null,
): { groundedIn: string[]; contextIn: string[]; warnings: string[] } {
  // An original format isn't built on a trend: any signals it names are context only.
  if (candidate.basis === "original") {
    candidate = { ...candidate, groundedIn: [], contextIn: [...candidate.groundedIn, ...(candidate.contextIn ?? [])] };
  }
  const warnings: string[] = [];
  const context = candidate.contextIn ?? [];
  if (!ledger) {
    const cited = candidate.groundedIn.length + context.length > 0;
    return { groundedIn: [], contextIn: [], warnings: cited ? ["Cited research signals, but no verified research was available."] : [] };
  }
  const known = new Set(ledger.signals.map((s) => s.id));
  const groundedIn = [...new Set(candidate.groundedIn)].filter((id) => known.has(id));
  // A signal is either direct evidence or context, never both; direct wins.
  const contextIn = [...new Set(context)].filter((id) => known.has(id) && !groundedIn.includes(id));
  const unknown = [...candidate.groundedIn, ...context].filter((id) => !known.has(id));
  if (unknown.length) warnings.push(`Ignored unknown signal IDs: ${unknown.join(", ")}.`);
  // The idea is kept, but a signal with no validated observations is inspiration, not direct evidence.
  for (const id of groundedIn) {
    const signal = ledger.signals.find((s) => s.id === id)!;
    if (signal.observationIds.length === 0) {
      warnings.push(
        `${id} ("${signal.name}") has no validated observations, so it inspired this idea but isn't direct supporting evidence.`,
      );
    }
  }
  const quotes = ledger.citations.map((c) => c.quote);
  // Ledger IDs (G1, O3, C2, S4) are references, not figures.
  if (!numbersSupported(candidate.evidenceBasis.replace(/\b[GOCS]\d+\b/g, ""), quotes)) {
    warnings.push("Its evidence summary contains a figure that doesn't appear in any cited source.");
  }
  return { groundedIn, contextIn, warnings };
}
