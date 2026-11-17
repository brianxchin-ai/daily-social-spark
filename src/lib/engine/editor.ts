import "server-only";

import { audienceLine } from "@/lib/prompts/audience";
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
1. Name the single most significant CREATIVE weakness: something about the idea itself that limits its organic distribution (stop power in the first second, holding attention to the payoff, shareability, how easily people can join in, brand or platform fit, dependence on a specific track, or how hard it is to make). Do not critique cultural relevance, trend momentum or performance; those are judged elsewhere.
2. Decide whether one revision could meaningfully improve the idea. If the idea is already strong or the weakness is inherent to it, say no; a revision is not required.
3. Only if justified, write exactly one revised version that:
   - keeps the same core creative mechanic (it must still be recognizably the same idea),
   - changes only what is needed to address that weakness,
   - adds no cultural, momentum, performance or statistical claims, and no URLs, outlets or handles,
   - keeps the same basis (a trend idea stays built on the same signal; an original format stays original), the same groundedIn signals and the same underlying cultural claim, so the evidence behind the original still applies (don't add or change evidence),
   - stays makeable on a phone by one or two people in a day,
   - stays within scope: published short-form content (vertical video, photos and carousels, text posts), never live streams, AR effects or Lenses, ephemeral Stories or paid ads,
   - keeps every field complete, with a headline of 12 words or fewer, and rewrites the walkthrough so it matches the revised idea,
   - if an intended audience is given, keeps the connection with it natural, never forced or stereotyped, and updates audienceConnection to match.

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
  timeoutMs = 120_000,
  signal?: AbortSignal,
): Promise<{
  critique: Critique;
  revision: { ok: true; draft: CandidateDraft } | { ok: false; problems: string[] } | null;
  usage: ScanUsage;
}> {
  const { value, usage } = await callStructured({
    step: "editor",
    system: EDITOR_SYSTEM,
    user: `Brand or category: ${request.brand}
Platform: ${platformLabel(request.platform)}${audienceLine(request.audience)}

The leading idea:
${describeLeader(leader, leaderResults)}`,
    schema: EditorSchema,
    maxTokens: 10_000, // worst case ≈ $0.10 of output
    timeoutMs,
    validate: validateEditor,
    signal,
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
