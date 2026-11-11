import { nearDuplicate, type EvidenceLedger } from "../research/ledger.ts";

/**
 * Lightweight checks on the range of the three candidates. They label
 * problems; they never remove, rescore or regenerate a candidate, and they
 * add no model calls. Code can catch near-duplicates that share a territory
 * label, their direct evidence and their mechanic wording. Two ideas that are
 * the same concept in different words can still slip through: that is a
 * semantic judgment code can't make reliably.
 */

export interface DiversityCandidate {
  id: string;
  trendName: string;
  territory: string;
  mechanic: string;
  concept: string;
  groundedIn: string[];
  contextIn: string[];
}

export interface DiversityReport {
  nearDuplicates: { a: string; b: string; reason: string }[];
  /** The ledger had adjacent or off-category signals. */
  offCategoryAvailable: boolean;
  /** At least one candidate builds directly on one of them. */
  offCategoryUsed: boolean;
  notes: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const sameSet = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((x) => b.includes(x));

export function checkDiversity(candidates: DiversityCandidate[], ledger: EvidenceLedger | null): DiversityReport {
  const nearDuplicates: DiversityReport["nearDuplicates"] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      let reason: string | null = null;
      if (norm(a.territory) && norm(a.territory) === norm(b.territory)) reason = `same territory ("${a.territory}")`;
      else if (sameSet(a.groundedIn, b.groundedIn) && nearDuplicate(a.mechanic, b.mechanic)) reason = "same evidence and near-identical mechanic";
      else if (nearDuplicate(`${a.mechanic} ${a.concept}`, `${b.mechanic} ${b.concept}`)) reason = "near-identical mechanic and concept";
      if (reason) nearDuplicates.push({ a: a.id, b: b.id, reason });
    }
  }

  const offIds = new Set((ledger?.signals ?? []).filter((s) => s.categoryRelation !== "in-category").map((s) => s.id));
  const offCategoryAvailable = offIds.size > 0;
  const offCategoryUsed = candidates.some((c) => c.groundedIn.some((id) => offIds.has(id)));

  const notes: string[] = [];
  const name = (id: string) => candidates.find((c) => c.id === id)?.trendName ?? id;
  for (const d of nearDuplicates) notes.push(`"${name(d.a)}" and "${name(d.b)}" look like the same idea: ${d.reason}.`);
  if (offCategoryAvailable && !offCategoryUsed) {
    notes.push("The research included adjacent or off-category signals, but no candidate builds directly on one.");
  }
  return { nearDuplicates, offCategoryAvailable, offCategoryUsed, notes };
}
