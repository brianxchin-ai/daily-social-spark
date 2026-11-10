import { z } from "zod";

/**
 * The shapes Claude must return, in two layers:
 * - The plain schemas (`CandidateSetSchema`, `EvaluationSchema`) are sent to the
 *   API as structured-output formats, so answers are constrained to these shapes.
 *   They stay deliberately plain so every rule is one the API can enforce.
 * - The `validate…` functions are our own rulebook, run on our server afterwards,
 *   with the stricter checks (ranges, counts, uniqueness, non-empty text).
 *
 * Today's results are hypotheses: no hour-based timing predictions, no URLs,
 * no invented outlets or numbers.
 */

/* ---------- Generator: three candidate opportunities ---------- */

export const CandidateDraftSchema = z.object({
  trendName: z.string().describe("Short name for the format or behavior, e.g. a creator format."),
  headline: z
    .string()
    .describe("Short display headline: a punchy instruction of 12 words or fewer. The full idea goes in concept."),
  concept: z
    .string()
    .describe(
      "The fuller creative concept in 2 to 4 sentences: what the content is, who appears in it, how it works, and what makes it ownable for this brand.",
    ),
  mechanic: z
    .string()
    .describe("The underlying creative mechanic in one sentence, independent of this brand."),
  whyItWillSpread: z.string().describe("Why this format has distribution and algorithmic potential."),
  whyNow: z.string().describe("The cultural or platform reasoning for acting now, framed as a hypothesis."),
  timing: z.object({
    stage: z.enum(["rising", "accelerating", "near-peak", "unclear"]),
    reasoning: z.string().describe("Why you believe it is at this stage. No hour or date predictions."),
    whatWouldConfirm: z.string().describe("The observable signals that would confirm or refute this stage."),
  }),
  audioRole: z
    .enum(["audio-led", "audio-optional", "no-audio"])
    .describe("audio-led: the idea is built around a particular sound or track."),
  audioVariations: z
    .array(z.string())
    .describe(
      "For audio-led ideas: at least 3 alternative executions that keep the mechanic without copying the original track (original voiceover, silence, visual-only, different audio). Otherwise an empty list.",
    ),
  signalsToVerify: z
    .array(
      z.object({
        signal: z.string().describe("What to look for. Never a URL, outlet name, or statistic."),
        whereToCheck: z.string().describe("Where a person could check it, e.g. a platform surface or search."),
        whyItMatters: z.string(),
      }),
    )
    .describe("3 to 5 signals a person should verify before acting."),
  formatIdeas: z
    .array(
      z.object({
        title: z.string(),
        hook: z.string().describe("The first-second hook, as on-screen text or opening line."),
        description: z.string(),
      }),
    )
    .describe("Exactly 3 distinct execution ideas for this brand."),
  risks: z.array(z.string()).describe("2 to 4 watch-outs."),
});

export const CandidateSetSchema = z.object({
  candidates: z
    .array(CandidateDraftSchema)
    .describe("Exactly 3 candidates, each built on a genuinely different creative mechanic."),
});

export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

/* ---------- Evaluator: scores for the five concept criteria ---------- */

const ConceptScoreSchema = z.object({
  score: z.number().describe("Integer from 1 to 5, using the anchors given."),
  rationale: z.string().describe("One concise sentence (25 words or fewer) explaining the score."),
});

export const EvaluationSchema = z.object({
  evaluations: z
    .array(
      z.object({
        label: z.enum(["A", "B", "C"]),
        remixability: ConceptScoreSchema,
        comprehension: ConceptScoreSchema,
        audioPortability: ConceptScoreSchema,
        brandPlatformFit: ConceptScoreSchema,
        crossPlatform: ConceptScoreSchema,
        culturalRelevanceEvidenceNeeded: z
          .string()
          .describe("Not a score. One sentence: what live evidence would establish cultural relevance."),
        emergingMomentumEvidenceNeeded: z
          .string()
          .describe("Not a score. One sentence: what live evidence would establish emerging momentum."),
        meaningfulAudioVariations: z
          .number()
          .describe(
            "How many of the listed audio variations genuinely preserve the mechanic without copying the original track. 0 if none are listed.",
          ),
      }),
    )
    .describe("One entry per candidate, A, B and C."),
});

export type EvaluationDraft = z.infer<typeof EvaluationSchema>;

/* ---------- Our rulebook ---------- */

const nonEmpty = z.string().trim().min(1);
const noUrls = (value: unknown) => !/https?:\/\/|www\./i.test(JSON.stringify(value));

const StrictCandidateSchema = CandidateDraftSchema.extend({
  trendName: nonEmpty,
  headline: nonEmpty,
  concept: nonEmpty,
  mechanic: nonEmpty,
  whyItWillSpread: nonEmpty,
  whyNow: nonEmpty,
  audioVariations: z.array(nonEmpty),
  signalsToVerify: CandidateDraftSchema.shape.signalsToVerify.min(3).max(5),
  formatIdeas: CandidateDraftSchema.shape.formatIdeas.length(3),
  risks: z.array(nonEmpty).min(2).max(4),
});

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const StrictCandidateSetSchema = z
  .object({ candidates: z.array(StrictCandidateSchema).length(3) })
  .superRefine((set, ctx) => {
    if (!noUrls(set)) ctx.addIssue({ code: "custom", message: "Hypotheses must not contain URLs." });
    const names = set.candidates.map((c) => normalize(c.trendName));
    const mechanics = set.candidates.map((c) => normalize(c.mechanic));
    if (new Set(names).size < names.length || new Set(mechanics).size < mechanics.length) {
      ctx.addIssue({ code: "custom", message: "Candidates must be distinct (duplicate trend name or mechanic)." });
    }
  });

const StrictScore = z.object({ score: z.number().int().min(1).max(5), rationale: nonEmpty });

const StrictEvaluationSchema = z
  .object({
    evaluations: z
      .array(
        EvaluationSchema.shape.evaluations.element.extend({
          remixability: StrictScore,
          comprehension: StrictScore,
          audioPortability: StrictScore,
          brandPlatformFit: StrictScore,
          crossPlatform: StrictScore,
          culturalRelevanceEvidenceNeeded: nonEmpty,
          emergingMomentumEvidenceNeeded: nonEmpty,
          meaningfulAudioVariations: z.number().int().min(0).max(20),
        }),
      )
      .length(3),
  })
  .superRefine((value, ctx) => {
    const labels = value.evaluations.map((e) => e.label).sort().join("");
    if (labels !== "ABC") {
      ctx.addIssue({ code: "custom", message: "Evaluations must cover A, B and C exactly once." });
    }
    if (!noUrls(value)) ctx.addIssue({ code: "custom", message: "Rationales must not contain URLs." });
  });

type Validated<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => [issue.path.join("."), issue.message].filter(Boolean).join(": "));
}

/** Our own check on the generator's answer, after the API's. */
export function validateCandidateSet(value: unknown): Validated<{ candidates: CandidateDraft[] }> {
  const result = StrictCandidateSetSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}

/** Our own check on the evaluator's answer, after the API's. */
export function validateEvaluation(value: unknown): Validated<EvaluationDraft> {
  const result = StrictEvaluationSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}
