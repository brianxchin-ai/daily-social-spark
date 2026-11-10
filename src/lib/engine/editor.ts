import "server-only";

import { criterion, type CriterionId, type CriterionResult } from "@/lib/evaluation/scoring";
import {
  EditorSchema,
  validateEditor,
  validateRevisedCandidate,
  type CandidateDraft,
} from "@/lib/spark-schema";
import type { ScanRequest } from "@/lib/types";
import { callStructured, platformLabel, type ScanUsage } from "./claude";

const EDITOR_SYSTEM = `You are a creative director giving one round of notes on a short-form social idea for a brand. You did not write it.

Your job, in order:
1. Name the single most significant CREATIVE weakness: something about the idea itself (clarity, repeatability, dependence on a specific track, brand or platform fit, portability). Do not critique cultural relevance, trend momentum or performance; those cannot be judged without live data.
2. Decide whether one revision could meaningfully improve the idea. If the idea is already strong or the weakness is inherent to it, say no; a revision is not required.
3. Only if justified, write exactly one revised version that:
   - keeps the same core creative mechanic (it must still be recognizably the same idea),
   - changes only what is needed to address that weakness,
   - adds no cultural, momentum, performance or statistical claims, and no URLs, outlets or handles,
   - keeps every field complete, with a headline of 12 words or fewer.

Do not score, rank or predict scores. A separate reviewer rescores any revision.

Write timing only as a hedged hypothesis; never use momentum labels such as rising, accelerating or near peak. Use American English spelling. Write em dashes closed, with no spaces around them.`;

function describeLeader(c: CandidateDraft, results: CriterionResult[]): string {
  const scored = results
    .filter((r) => r.status === "scored")
    .map((r) => `- ${criterion(r.criterionId).name}: ${r.score}/5. ${r.rationale}`)
    .join("\n");
  return `${JSON.stringify(c, null, 2)}

Reviewer's scores on the five concept criteria:
${scored}`;
}

export interface Critique {
  weakness: string;
  affectedCriterion: CriterionId;
  revisionJustified: boolean;
  decisionReason: string;
  changeSummary: string;
}

/**
 * Editor call: one critique and at most one revision. The revision is checked
 * against the same rulebook as the generator's candidates; if it fails, it is
 * reported (not retried) and the original is kept.
 */
export async function critiqueAndRevise(
  request: ScanRequest,
  leader: CandidateDraft,
  leaderResults: CriterionResult[],
): Promise<{
  critique: Critique;
  revision: { ok: true; draft: CandidateDraft } | { ok: false; problems: string[] } | null;
  usage: ScanUsage;
}> {
  const { value, usage } = await callStructured({
    step: "editor",
    system: EDITOR_SYSTEM,
    user: `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}

The leading idea:
${describeLeader(leader, leaderResults)}`,
    schema: EditorSchema,
    maxTokens: 10_000, // worst case ≈ $0.10 of output
    timeoutMs: 120_000,
    validate: validateEditor,
  });

  const critique: Critique = {
    weakness: value.weakness,
    affectedCriterion: value.affectedCriterion,
    revisionJustified: value.revisionJustified,
    decisionReason: value.decisionReason,
    changeSummary: value.changeSummary,
  };

  if (!value.revisionJustified) return { critique, revision: null, usage };

  const checked = validateRevisedCandidate(value.revisions[0]);
  if (!checked.ok) console.warn(`[claude:editor] revision failed validation: ${checked.problems.join("; ")}`);
  return {
    critique,
    revision: checked.ok ? { ok: true, draft: checked.value } : { ok: false, problems: checked.problems },
    usage,
  };
}
