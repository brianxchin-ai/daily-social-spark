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
  territory: z.string().describe("The creative territory in a few words, e.g. 'result-first reveal' or 'comment-reply ritual'."),
  basis: z
    .enum(["trend", "original"])
    .describe(
      "trend: built on a fresh trend from the research (name it in groundedIn). original: an original format not built on any trend, grounded in attention and behavioral principles and timely context.",
    ),
  groundedIn: z
    .array(z.string())
    .describe("Ledger signal IDs whose observations directly evidence this idea's mechanism. Empty if there is no ledger."),
  contextIn: z
    .array(z.string())
    .describe("Ledger signal IDs used only as context (related category, audience or behavior). Never proof of the mechanism."),
  evidenceBasis: z
    .string()
    .describe("Only what the ledger's observations establish, citing IDs. 'No live evidence for this scan.' if there is no ledger."),
  creativeLeap: z.string().describe("Your own inference: how the signal becomes an idea for this brand."),
  executionHypothesis: z.string().describe("What you think might work and why, framed as a hypothesis."),
  platformExecution: z
    .string()
    .describe("How the selected platform shapes this idea's hook, pacing, audience participation and format."),
  walkthrough: z
    .string()
    .describe(
      "A short production walkthrough of ONE execution, start to finish, written as prose like a director's treatment: the opening shot and hook, what happens, the turn or payoff, and how it ends. For a photo, carousel or text post, walk through it image by image, slide by slide or line by line. 80 to 150 words, in one or two short paragraphs. No URLs, handles, statistics or performance claims.",
    ),
  whyItWillSpread: z.string().describe("Why this format has distribution and algorithmic potential."),
  audienceConnection: z
    .string()
    .describe(
      "If an intended audience was given: one sentence on how the idea connects with that audience, or why its broad appeal still lands with them. Empty string if no audience was given.",
    ),
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
    .describe(
      "Exactly 3 distinct execution ideas for this brand. Vary the creative approach (angle, framing, hook, casting, structure, tone). At least two must use the same format as the walkthrough; at most one may switch format.",
    ),
  risks: z.array(z.string()).describe("2 to 4 watch-outs."),
});

/** Behaviors that drive organic distribution. The Generator names the ones its bet relies on. */
export const DISTRIBUTION_DRIVERS = ["watch-time", "completion", "rewatch", "shares", "saves", "comments", "participation"] as const;
export type DistributionDriver = (typeof DISTRIBUTION_DRIVERS)[number];

export const LonglistIdeaSchema = z.object({
  id: z.string().describe("L1 to L10, in order."),
  trendName: z.string(),
  headline: z.string().describe("A short display headline, 12 words or fewer."),
  mechanic: z.string().describe("The underlying creative mechanic in one sentence."),
  territory: z.string().describe("The creative territory in a few words."),
  basis: z.enum(["trend", "original"]).describe("trend: built on a fresh research trend. original: an original format, not built on any trend."),
  groundedIn: z.array(z.string()).describe("Ledger signal IDs the idea builds on. Empty for an original format."),
  distributionDrivers: z
    .array(z.enum(DISTRIBUTION_DRIVERS))
    .describe("The 1 to 3 behaviors the distribution bet relies on most."),
  distributionBet: z
    .string()
    .describe("One sentence hypothesizing how the idea would earn organic distribution. No numbers or predicted metrics."),
});

export const CandidateSetSchema = z.object({
  longlist: z.array(LonglistIdeaSchema).describe("Exactly 10 short ideas, written before choosing."),
  selection: z.object({
    picks: z
      .array(z.object({ id: z.string().describe("A longlist ID."), reason: z.string().describe("One sentence on why it made the cut.") }))
      .describe("Exactly 3 picks, in the same order as candidates."),
    setAside: z.string().describe("One or two sentences on why the other seven didn't make the cut."),
  }),
  candidates: z
    .array(CandidateDraftSchema)
    .describe("Exactly 3 candidates: the 3 picks developed in full, in pick order, each built on a genuinely different creative mechanic."),
});

export type CandidateSet = z.infer<typeof CandidateSetSchema>;

export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

/* ---------- Evaluator: scores for the five concept criteria ---------- */

const ConceptScoreSchema = z.object({
  score: z.number().describe("Integer from 1 to 5, using the anchors given."),
  rationale: z.string().describe("One concise sentence (25 words or fewer) explaining the score."),
});

const RelevanceSchema = z.object({
  score: z.number().describe("Integer from 1 to 5: your judgment of cultural relevance, using the anchors given."),
  rationale: z.string().describe("One concise sentence (25 words or fewer) explaining the score."),
  observationIds: z.array(z.string()).describe("Ledger observation IDs (O1, O2…) your judgment draws on. Empty if none."),
  judgedFrom: z
    .enum(["research", "general-knowledge", "both"])
    .describe("What the judgment leans on: this scan's research, your general cultural knowledge, or both."),
});

/** The criteria the evaluator scores for each candidate (shared by evaluation and rescoring). */
const AssessmentFields = {
  stopPower: ConceptScoreSchema,
  watchThrough: ConceptScoreSchema,
  shareability: ConceptScoreSchema,
  participation: ConceptScoreSchema,
  brandFit: ConceptScoreSchema.describe(
    "Does the execution work for this brand or category (and the intended audience, if given)? Judged separately from platform.",
  ),
  platformFit: ConceptScoreSchema.describe("Does it feel native to the selected platform? Judged separately from brand."),
  culturalRelevance: RelevanceSchema,
  makeable: z
    .boolean()
    .describe("Could one or two people make it on a phone in a day, with no special locations, talent, sets, effects or paid production?"),
  makeableNote: z.string().describe("One short sentence on what making it would take."),
  meaningfulAudioVariations: z
    .number()
    .describe(
      "How many of the listed audio variations genuinely preserve the mechanic without copying the original track. 0 if none are listed.",
    ),
};

export const EvaluationSchema = z.object({
  evaluations: z
    .array(z.object({ label: z.enum(["A", "B", "C"]), ...AssessmentFields }))
    .describe("One entry per candidate, using each label you were given exactly once."),
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
  territory: nonEmpty,
  groundedIn: z.array(nonEmpty).max(3),
  contextIn: z.array(nonEmpty).max(3),
  evidenceBasis: nonEmpty,
  creativeLeap: nonEmpty,
  executionHypothesis: nonEmpty,
  platformExecution: nonEmpty,
  walkthrough: nonEmpty,
  whyItWillSpread: nonEmpty,
  whyNow: nonEmpty,
  audioVariations: z.array(nonEmpty),
  signalsToVerify: CandidateDraftSchema.shape.signalsToVerify.min(3).max(5),
  formatIdeas: CandidateDraftSchema.shape.formatIdeas.length(3),
  risks: z.array(nonEmpty).min(2).max(4),
});

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const StrictLonglistIdea = LonglistIdeaSchema.extend({
  id: nonEmpty,
  trendName: nonEmpty,
  headline: nonEmpty,
  mechanic: nonEmpty,
  territory: nonEmpty,
  groundedIn: z.array(nonEmpty).max(3),
  distributionDrivers: LonglistIdeaSchema.shape.distributionDrivers.min(1).max(3),
  distributionBet: nonEmpty,
});

const StrictCandidateSetSchema = z
  .object({
    longlist: z.array(StrictLonglistIdea).length(10),
    selection: z.object({
      picks: z.array(z.object({ id: nonEmpty, reason: nonEmpty })).length(3),
      setAside: nonEmpty,
    }),
    candidates: z.array(StrictCandidateSchema).length(3),
  })
  .superRefine((set, ctx) => {
    if (!noUrls(set)) ctx.addIssue({ code: "custom", message: "Hypotheses must not contain URLs." });
    const ids = set.longlist.map((l) => l.id.trim());
    if (new Set(ids).size < ids.length) ctx.addIssue({ code: "custom", message: "Longlist IDs must be unique." });
    const picks = set.selection.picks.map((p) => p.id.trim());
    if (new Set(picks).size < picks.length || picks.some((id) => !ids.includes(id))) {
      ctx.addIssue({ code: "custom", message: "Picks must be 3 different longlist IDs." });
    }
    const names = set.candidates.map((c) => normalize(c.trendName));
    const mechanics = set.candidates.map((c) => normalize(c.mechanic));
    if (new Set(names).size < names.length || new Set(mechanics).size < mechanics.length) {
      ctx.addIssue({ code: "custom", message: "Candidates must be distinct (duplicate trend name or mechanic)." });
    }
  });

const StrictScore = z.object({ score: z.number().int().min(1).max(5), rationale: nonEmpty });
const StrictRelevance = RelevanceSchema.extend({
  score: z.number().int().min(1).max(5),
  rationale: nonEmpty,
  observationIds: z.array(z.string()).max(12),
});
const StrictAssessment = {
  stopPower: StrictScore,
  watchThrough: StrictScore,
  shareability: StrictScore,
  participation: StrictScore,
  brandFit: StrictScore,
  platformFit: StrictScore,
  culturalRelevance: StrictRelevance,
  makeable: z.boolean(),
  makeableNote: nonEmpty,
  meaningfulAudioVariations: z.number().int().min(0).max(20),
};

/** The review's rulebook for `count` candidates (1 to 3), labeled A, B, C in order. The fixed workflow always sends 3. */
function strictEvaluationSchema(count: number) {
  const expected = "ABC".slice(0, count);
  return z
    .object({
      evaluations: z.array(EvaluationSchema.shape.evaluations.element.extend(StrictAssessment)).length(count),
    })
    .superRefine((value, ctx) => {
      const labels = value.evaluations.map((e) => e.label).sort().join("");
      if (labels !== expected) {
        ctx.addIssue({ code: "custom", message: `Evaluations must cover ${expected.split("").join(", ")} exactly once.` });
      }
      if (!noUrls(value)) ctx.addIssue({ code: "custom", message: "Rationales must not contain URLs." });
    });
}

type Validated<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => [issue.path.join("."), issue.message].filter(Boolean).join(": "));
}

/** Our own check on the generator's answer, after the API's. */
export function validateCandidateSet(value: unknown): Validated<CandidateSet> {
  const result = StrictCandidateSetSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}

/** Day 6 (agent mode): one batch of longlist ideas the agent adds. Code assigns the IDs. */
const StrictLonglistBatch = z
  .array(StrictLonglistIdea.omit({ id: true }))
  .min(1)
  .max(10)
  .refine(noUrls, { message: "Ideas must not contain URLs." });

export type LonglistIdeaDraft = Omit<z.infer<typeof LonglistIdeaSchema>, "id">;

export function validateLonglistBatch(value: unknown): Validated<LonglistIdeaDraft[]> {
  const result = StrictLonglistBatch.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}

/** Our own check on the evaluator's answer, after the API's. */
export function validateEvaluation(value: unknown, count = 3): Validated<EvaluationDraft> {
  const result = strictEvaluationSchema(count).safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}

/* ---------- Checkpoint 4: editor (critique + at most one revision) ---------- */

const CONCEPT_CRITERION_IDS = ["stopPower", "watchThrough", "shareability", "participation", "brandPlatformFit"] as const;

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
  ...AssessmentFields,
  preservesMechanic: z.boolean().describe("Does the revision keep the original core creative mechanic?"),
  addressesWeakness: z.boolean().describe("Does the revision address the named weakness?"),
  introducesUnsupportedClaims: z
    .boolean()
    .describe("Does the revision add cultural, momentum or performance claims that can't be supported without data?"),
  checksRationale: z.string().describe("One sentence explaining the three yes/no checks."),
});

export type RescoreDraft = z.infer<typeof RescoreSchema>;

const StrictRescoreSchema = RescoreSchema.extend({
  ...StrictAssessment,
  checksRationale: nonEmpty,
}).refine(noUrls, { message: "Rationales must not contain URLs." });

export function validateRescore(value: unknown): Validated<RescoreDraft> {
  const result = StrictRescoreSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, problems: describeIssues(result.error) };
}
