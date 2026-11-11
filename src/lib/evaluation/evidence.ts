import {
  ageInDays,
  MOMENTUM_WINDOW_DAYS,
  numbersSupported,
  RELEVANCE_WINDOW_DAYS,
  type EvidenceLedger,
  type LedgerObservation,
} from "../research/ledger.ts";
import type { CriterionId, CriterionResult } from "./scoring.ts";

/**
 * Evidence-aware scoring for Cultural Relevance and Emerging Momentum.
 *
 * The evaluator PROPOSES a 1–5 score and names the ledger observations it
 * rests on. Code decides whether the score may stand:
 *  - only with a verified ledger, and only from signals the candidate is
 *    grounded in (the evidence must belong to this idea's cultural claim);
 *  - only if those signals clear the ledger's eligibility rules;
 *  - Cultural Relevance needs a cited observation with a behavior date in the
 *    relevance window; Emerging Momentum needs a cited, behavior-dated
 *    increase in the momentum window. Recency, publication dates, popularity
 *    totals and novelty never count as acceleration;
 *  - the score is capped at what the evidence allows.
 * Anything else is Unverified, with the reason.
 */

export interface EvidenceProposal {
  /** 1–5, or 0 when the evaluator judged it can't be scored. */
  proposedScore: number;
  observationIds: string[];
  rationale: string;
}

type EvidenceCriterion = Extract<CriterionId, "culturalRelevance" | "emergingMomentum">;

function unverified(criterionId: EvidenceCriterion, reason: string): CriterionResult {
  return { criterionId, status: "unverified", score: null, rationale: reason };
}

export function evidenceResult(
  criterionId: EvidenceCriterion,
  proposal: EvidenceProposal,
  ledger: EvidenceLedger | null,
  groundedIn: string[],
): CriterionResult {
  if (!ledger) return unverified(criterionId, "No verified research for this scan.");
  const signals = ledger.signals.filter((s) => groundedIn.includes(s.id));
  if (signals.length === 0) return unverified(criterionId, "This idea isn't grounded in a researched signal.");

  const now = new Date(ledger.createdAt);
  const cited = ledger.observations.filter(
    (o) => proposal.observationIds.includes(o.id) && signals.some((s) => s.id === o.signalId),
  );
  const proposed = proposal.proposedScore;
  if (!Number.isInteger(proposed) || proposed < 1 || proposed > 5) {
    return unverified(criterionId, proposal.rationale || "The reviewer judged it can't be scored from the evidence.");
  }
  if (cited.length === 0) {
    return unverified(criterionId, "No cited observation from this idea's own signals supports the score.");
  }

  const key = criterionId === "culturalRelevance" ? "culturalRelevance" : "momentum";
  const eligible = signals.filter((s) => s[key].status === "eligible" && cited.some((o) => o.signalId === s.id));
  if (eligible.length === 0) {
    return unverified(criterionId, signals.map((s) => s[key].reason).find(Boolean) ?? "The evidence doesn't meet the bar.");
  }

  const qualifies = (o: LedgerObservation) => {
    const age = ageInDays(o.behavior, now);
    if (age === null) return false;
    return criterionId === "culturalRelevance"
      ? age <= RELEVANCE_WINDOW_DAYS
      : o.kind === "growth" && age <= MOMENTUM_WINDOW_DAYS;
  };
  if (!cited.some(qualifies)) {
    return unverified(
      criterionId,
      criterionId === "culturalRelevance"
        ? `None of the cited observations has a behavior date in the last ${RELEVANCE_WINDOW_DAYS} days.`
        : `None of the cited observations is a behavior-dated increase in the last ${MOMENTUM_WINDOW_DAYS} days.`,
    );
  }

  const cap = Math.max(...eligible.map((s) => s[key].maxScore ?? 0));
  const score = Math.min(proposed, cap);
  const capped = score < proposed ? ` (capped at ${cap} by the strength of the evidence)` : "";
  return {
    criterionId,
    status: "scored",
    score,
    rationale: `${proposal.rationale}${capped}`,
    observationIds: cited.map((o) => o.id),
  };
}

/** Signal IDs a candidate claims, kept only if they exist in the ledger. */
export function checkGrounding(
  candidate: { groundedIn: string[]; contextIn?: string[]; evidenceBasis: string },
  ledger: EvidenceLedger | null,
): { groundedIn: string[]; contextIn: string[]; warnings: string[] } {
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

export type EvidenceSupport = "yes" | "partly" | "no" | "not-applicable";

/**
 * Carry the original's evidence scores to the revision only where the
 * rescorer confirms the same evidence still supports the revised idea and the
 * cultural claim didn't change. Otherwise the revision's evidence criterion
 * is Unverified. Pure, so it can be tested.
 */
export function revisedEvidence(
  originalResults: CriterionResult[],
  support: { culturalRelevance: EvidenceSupport; emergingMomentum: EvidenceSupport },
  claimChanged: boolean,
): CriterionResult[] {
  return (["culturalRelevance", "emergingMomentum"] as const).map((id): CriterionResult => {
    const original = originalResults.find((r) => r.criterionId === id)!;
    if (original.status !== "scored") return original;
    if (!claimChanged && support[id] === "yes") return original;
    return {
      criterionId: id,
      status: "unverified",
      score: null,
      rationale: claimChanged
        ? "The revision changed the cultural claim, so the original evidence no longer applies."
        : `The reviewer judged the original evidence supports the revision only "${support[id]}".`,
    };
  });
}

