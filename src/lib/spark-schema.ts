import { z } from "zod";

/**
 * The shape Claude must return for one Spark hypothesis.
 *
 * Two layers:
 * - `SparkDraftSchema` is sent to the API as the structured-output format, so
 *   Claude's answer is constrained to this shape. It stays deliberately plain
 *   (no numeric ranges or lengths) so every rule is one the API can enforce.
 * - `validateSparkDraft` is our own rulebook, run on our server afterwards,
 *   with the stricter checks (ranges, counts, non-empty text).
 *
 * Today's results are hypotheses: no hour-based timing predictions, no URLs,
 * no invented outlets or numbers.
 */
export const SparkDraftSchema = z.object({
  trendName: z.string().describe("Short name for the format or behaviour, e.g. a creator format."),
  headline: z.string().describe("The opportunity, phrased as what the brand should make."),
  whyItWillSpread: z.string().describe("Why this format has distribution and algorithmic potential."),
  whyNow: z.string().describe("The cultural or platform reasoning for acting now, framed as a hypothesis."),
  timing: z.object({
    stage: z.enum(["rising", "accelerating", "near-peak", "unclear"]),
    reasoning: z.string().describe("Why you believe it is at this stage. No hour or date predictions."),
    whatWouldConfirm: z.string().describe("The observable signals that would confirm or refute this stage."),
  }),
  confidence: z.number().describe("0 to 100: how plausible this hypothesis is, given no live data."),
  confidenceRationale: z.string(),
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

export type SparkDraft = z.infer<typeof SparkDraftSchema>;

const nonEmpty = z.string().trim().min(1);

const StrictSparkDraftSchema = SparkDraftSchema.extend({
  trendName: nonEmpty,
  headline: nonEmpty,
  whyItWillSpread: nonEmpty,
  whyNow: nonEmpty,
  confidence: z.number().int().min(0).max(100),
  confidenceRationale: nonEmpty,
  signalsToVerify: SparkDraftSchema.shape.signalsToVerify.min(3).max(5),
  formatIdeas: SparkDraftSchema.shape.formatIdeas.length(3),
  risks: z.array(nonEmpty).min(2).max(4),
}).superRefine((draft, ctx) => {
  // Honesty rule: no links in a hypothesis.
  const text = JSON.stringify(draft);
  if (/https?:\/\/|www\./i.test(text)) {
    ctx.addIssue({ code: "custom", message: "Hypotheses must not contain URLs." });
  }
});

/** Our own check, after the API's. Returns readable problems instead of throwing. */
export function validateSparkDraft(
  value: unknown,
): { ok: true; draft: SparkDraft } | { ok: false; problems: string[] } {
  const result = StrictSparkDraftSchema.safeParse(value);
  if (result.success) return { ok: true, draft: result.data };
  return {
    ok: false,
    problems: result.error.issues.map((issue) =>
      [issue.path.join("."), issue.message].filter(Boolean).join(": "),
    ),
  };
}
