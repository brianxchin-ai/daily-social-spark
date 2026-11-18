import "server-only";

import { anthropicAgentModel, anthropicResearchTools } from "@/lib/agent/anthropic";
import { CallFailure, type AgentModel, type Billed, type PaidTools } from "@/lib/agent/loop";
import type { Brief } from "@/lib/agent/workspace";
import type { ScanRequest } from "@/lib/types";
import { callStructured, EngineError, getClient, platformLabel, type ScanUsage } from "./claude";
import { evaluateCandidates, rescoreRevision } from "./evaluator";
import { audienceLine } from "@/lib/prompts/audience";
import { gutCheckSystem } from "@/lib/prompts/creative";
import { GutCheckSchema, validateGutCheck } from "@/lib/spark-schema";

/**
 * Agent mode's real connections, for the server only. The review panel and
 * the rescore are the fixed pipeline's own calls (same instructions, same
 * rubric, candidates anonymized and shuffled), with model fallback turned off.
 */

function scanOf(brief: Brief): ScanRequest {
  return { brand: brief.brand, platform: brief.platform, audience: brief.audience, recentIdeas: brief.recentIdeas };
}

function billedOf(usage: ScanUsage): Billed {
  return { model: usage.model, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } };
}

/** The fixed pipeline's errors, translated for the governor: billed, possibly billed, or not billed. */
function failureOf(error: unknown): CallFailure {
  if (error instanceof EngineError) {
    if (error.usage) return new CallFailure(error.message, true, billedOf(error.usage));
    // Error responses (bad request, rate limit) aren't billed; anything cut off mid-flight may have been.
    return new CallFailure(error.message, ![400, 429].includes(error.status));
  }
  return new CallFailure("An unexpected error stopped the review.", true);
}

export function agentModel(): AgentModel {
  return anthropicAgentModel(getClient());
}

export function agentPaidTools(): PaidTools {
  const research = anthropicResearchTools(getClient());
  return {
    ...research,
    async evaluate({ brief, finalists, ledger, maxOutputTokens, timeoutMs, signal }) {
      try {
        const { assessments, usage } = await evaluateCandidates(scanOf(brief), finalists, ledger, {
          timeoutMs,
          signal,
          fallbacks: false,
          // Sized to how many ideas this review scores (1 to 3).
          maxTokens: maxOutputTokens,
        });
        return {
          assessments: assessments.map((a) => ({
            candidateId: a.candidateId,
            evaluatorLabel: a.label,
            results: a.results,
            meaningfulAudioVariations: a.meaningfulAudioVariations,
            makeable: a.makeable,
            makeableNote: a.makeableNote,
          })),
          billed: billedOf(usage),
        };
      } catch (error) {
        throw failureOf(error);
      }
    },
    async gutCheck({ brief, ideas, maxOutputTokens, timeoutMs, signal }) {
      try {
        const user = `Brand or category: ${brief.brand}
Platform: ${platformLabel(brief.platform)}${audienceLine(brief.audience)}

${ideas.map((i) => `${i.label}. Headline: ${i.headline}\n   Mechanic: ${i.mechanic}\n   Territory: ${i.territory}`).join("\n")}

Give a quick read on ideas 1 to ${ideas.length}.`;
        const { value, usage } = await callStructured({
          step: "gut-check",
          system: gutCheckSystem(brief.platform),
          user,
          schema: GutCheckSchema,
          maxTokens: maxOutputTokens,
          timeoutMs,
          validate: (v) => validateGutCheck(v, ideas.length),
          signal,
          fallbacks: false,
        });
        return { reads: value.reads, billed: billedOf(usage) };
      } catch (error) {
        throw failureOf(error);
      }
    },
    async rescore({ brief, original, revised, weakness, groundedIn, ledger, timeoutMs, signal }) {
      try {
        const r = await rescoreRevision(scanOf(brief), { original, revised, weakness, groundedIn, ledger }, timeoutMs, signal, { fallbacks: false });
        return {
          assessment: { evaluatorLabel: "A", results: r.results, meaningfulAudioVariations: r.meaningfulAudioVariations, makeable: r.makeable, makeableNote: r.makeableNote },
          checks: r.checks,
          checksRationale: r.checksRationale,
          billed: billedOf(r.usage),
        };
      } catch (error) {
        throw failureOf(error);
      }
    },
  };
}
