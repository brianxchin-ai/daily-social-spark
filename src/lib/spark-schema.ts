import { z } from "zod";

/**
 * The shapes Claude must return, in two layers:
 * - The plain schemas (`CandidateSetSchema`, `EvaluationSchema`) are sent to the
 *   API as structured-output formats, so answers are constrained to these shapes.
 *   They stay deliberately plain so every rule is one the API can enforce.
 * - The `validate…` functions are our own rulebook, run on our server afterwards,
 *   with the stricter checks (ranges, counts, uniqueness, non-empty text).
 *
 * Today's results are hypotheses: no momentum classifications, no hour-based
 * timing predictions, no URLs, no invented outlets or numbers.
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
    hypothesis: z
      .string()
      .describe(
        "A clearly hedged timing hypothesis from general knowledge. No momentum labels (rising, accelerating, near peak), hours or dates.",
      ),
    whatWouldConfirm: z.string().describe("The observable signals that would confirm or refute the hypothesis."),
  }),
  audioRole: z
    .enum(["audio-led", "audio-optional", "no-audio"])
    .describe(
      "audio-led: built around a particular existing song, sound or track. Original narration, voiceover or dialogue does not count.",
    ),
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

/* ---------- Checkpoint 4: editor (critique + at most one revision) ---------- */

const CONCEPT_CRITERION_IDS = [
  "remixability",
  "comprehension",
  "audioPortability",
  "brandPlatformFit",
  "crossPlatform",
] as const;

export const EditorSchema = z.object({
  weakness: z.string().describe("The single most significant creative weakness, in one or two sentences."),
  affectedCriterion: z
    .enum(CONCEPT_CRITERION_IDS)
    .describe("The concept criterion this weakness most affects."),
  revisionJustified: z.boolean().describe("True only if one revision could meaningfully improve the idea."),
  decisionReason: z.string().describe("One sentence explaining the decision."),
  revisions: z
    .array(CandidateDraftSchema)
    .describe("Exactly one revised candidate if revisionJustified is true; otherwise an empty list."),
  changeSummary: z.string().describe("One or two sentences on what changed and why. Empty if no revision."),
});

export type EditorDraft = z.infer<typeof EditorSchema>;

const StrictEditorSchema = z
  .object({
    weakness: nonEmpty,
    affectedCriterion: z.enum(CONCEPT_CRITERION_IDS),
    revisionJustified: z.boolean(),
    decisionReason: nonEmpty,
    // The revision itself is validated separately, so a bad revision keeps the
    // original (an inspectable outcome) instead of failing the whole step.
    revisions: z.array(z.unknown()).max(1),
    changeSummary: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.revisionJustified !== (value.revisions.length === 1)) {
      ctx.addIssue({ code: "custom", message: "Exactly one revision is required when justified, none otherwise." });
    }
    if (!noUrls({ weakness: value.weakness, decisionReason: value.decisionReason })) {
      ctx.addIssue({ code: "custom", message: "Critique must not contain URLs." });
    }
  });

export function validateEditor(
  value: unknown,
): Validated<Omit<EditorDraft, "revisions"> & { revisions: unknown[] }> {
  const result = StrictEditorSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}

/** Same rulebook as the generator's candidates, applied to the single revision. */
export function validateRevisedCandidate(value: unknown): Validated<CandidateDraft> {
  const result = StrictCandidateSchema.safeParse(value);
  if (!result.success) return { ok: false, problems: describeIssues(result.error) };
  if (!noUrls(result.data)) return { ok: false, problems: ["Revision must not contain URLs."] };
  return { ok: true, value: result.data };
}

/* ---------- Checkpoint 4: rescoring the revision ---------- */

export const RescoreSchema = z.object({
  remixability: ConceptScoreSchema,
  comprehension: ConceptScoreSchema,
  audioPortability: ConceptScoreSchema,
  brandPlatformFit: ConceptScoreSchema,
  crossPlatform: ConceptScoreSchema,
  culturalRelevanceEvidenceNeeded: z.string().describe("Not a score. What live evidence would establish it."),
  emergingMomentumEvidenceNeeded: z.string().describe("Not a score. What live evidence would establish it."),
  meaningfulAudioVariations: z.number().describe("As before: meaningful, non-copying alternatives. 0 if none."),
  preservesMechanic: z.boolean().describe("Does the revision keep the original core creative mechanic?"),
  addressesWeakness: z.boolean().describe("Does the revision address the named weakness?"),
  introducesUnsupportedClaims: z
    .boolean()
    .describe("Does the revision add cultural, momentum or performance claims that can't be supported without data?"),
  checksRationale: z.string().describe("One sentence explaining the three yes/no checks."),
});

export type RescoreDraft = z.infer<typeof RescoreSchema>;

const StrictRescoreSchema = RescoreSchema.extend({
  remixability: StrictScore,
  comprehension: StrictScore,
  audioPortability: StrictScore,
  brandPlatformFit: StrictScore,
  crossPlatform: StrictScore,
  culturalRelevanceEvidenceNeeded: nonEmpty,
  emergingMomentumEvidenceNeeded: nonEmpty,
  meaningfulAudioVariations: z.number().int().min(0).max(20),
  checksRationale: nonEmpty,
}).refine(noUrls, { message: "Rationales must not contain URLs." });

export function validateRescore(value: unknown): Validated<RescoreDraft> {
  const result = StrictRescoreSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}
