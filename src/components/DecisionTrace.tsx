import { formatScore } from "@/lib/evaluation/scoring";
import type { HypothesisSpark } from "@/lib/types";
import { plural, researchSummary } from "./EvidenceStatus";
import { computeTies, tieSentence } from "./Scoreboard";

interface Step {
  title: string;
  status: "done" | "skipped" | "failed" | "flag";
  lines: string[];
}

/**
 * What actually happened, in order, built only from the result's own data:
 * the calls that ran, the decisions our code made, and every step that was
 * skipped or failed. Nothing is described that didn't happen.
 */
export function buildTrace(spark: HypothesisSpark): Step[] {
  const name = (id: string) => spark.candidates.find((c) => c.id === id)?.trendName ?? id;
  const steps: Step[] = [];
  const research = spark.research;
  const ran = new Set(spark.generation.calls.map((c) => c.step));

  // 1. Research
  if (research.status === "verified") {
    const l = research.ledger;
    const usage = l.researchUsage;
    steps.push({
      title: "Research",
      status: "done",
      lines: [
        `${plural(l.discovery.searches, "search", "searches")} (${l.discovery.brandFreeSearches} beyond the brand, ${l.discovery.crossCategorySearches} beyond the category): ${l.queries.map((q) => `“${q}”`).join(", ")}.`,
        `${l.sources.length} sources returned${l.sources.some((s) => s.setAside) ? `, ${l.sources.filter((s) => s.setAside).length} set aside` : ""}; ${l.citations.length} verbatim quotes.`,
        `${l.signals.length} signals filed with ${l.observations.length} observations and ${l.inferences.length} labeled interpretations.`,
        `The signed research handoff was verified for this brand and platform before use.`,
        ...(usage ? [`Research calls: ${usage.calls.map((c) => c.step).join(" + ")} · ≈$${usage.estimatedCostUsd.toFixed(3)}.`] : []),
      ],
    });
  } else {
    steps.push({
      title: "Research",
      status: research.status === "off" ? "skipped" : "failed",
      lines: [researchSummary(research).text, "No research evidence was used; the scan continued as a creative hypothesis."],
    });
  }

  // 2. Generation
  const flags = spark.diversity.notes;
  const warnings = spark.candidates.flatMap((c) => (c.groundingWarnings ?? []).map((w) => `${c.trendName}: ${w}`));
  steps.push({
    title: "Three ideas generated",
    status: flags.length || warnings.length ? "flag" : "done",
    lines: [
      spark.candidates.map((c) => `“${c.trendName}” (${c.territory})`).join("; ") + ".",
      ...flags.map((n) => `Range check: ${n}`),
      ...warnings,
    ],
  });

  // 3. Evaluation
  const evidenceResults = spark.evaluation.evaluations.flatMap((e) =>
    e.results.filter((r) => r.criterionId === "culturalRelevance" || r.criterionId === "emergingMomentum"),
  );
  const verified = evidenceResults.filter((r) => r.status === "scored").length;
  steps.push({
    title: "Independent evaluation",
    status: "done",
    lines: [
      "A separate reviewer call scored all three ideas, anonymized and shuffled.",
      `${verified} of ${evidenceResults.length} evidence scores passed our checks; the rest are unverified and count as a neutral 3 for ranking only.`,
    ],
  });

  // 4. Ranking
  const ties = computeTies(spark.evaluation);
  const ranked = spark.evaluation.evaluations;
  steps.push({
    title: "Ranking by our code",
    status: ties.length ? "flag" : "done",
    lines: [
      ranked
        .map((e) => `${e.score.rank ? `#${e.score.rank}` : "Rejected"} ${name(e.candidateId)}: ${formatScore(e.score.rankingScore)}${e.score.provisional ? " (provisional)" : ""}`)
        .join(" · "),
      ...ties.map((t) => tieSentence(t, name)),
      ...ranked.filter((e) => e.score.rejected).flatMap((e) => e.score.rejectionReasons.map((r) => `${name(e.candidateId)} rejected: ${r.message}`)),
      spark.evaluation.leaderId ? `Leader: “${name(spark.evaluation.leaderId)}”.` : "No idea cleared the bar, so nothing was recommended.",
    ],
  });

  // 5–6. Editor and revision
  const r = spark.refinement;
  if (r.status === "skipped") {
    steps.push({ title: "Editor critique", status: "skipped", lines: [r.reason, "No editor or rescore call was made."] });
  } else if (r.status === "failed") {
    steps.push({
      title: r.step === "editor" ? "Editor critique" : "Rescore",
      status: "failed",
      lines: [r.message, "Nothing was retried; the evaluated leader stands unrevised."],
    });
  } else {
    steps.push({
      title: "Editor critique",
      status: "done",
      lines: [
        `Biggest weakness: ${r.critique.weakness}`,
        `Revision justified: ${r.critique.revisionJustified ? "yes" : "no"}. ${r.critique.decisionReason}`,
      ],
    });
    if (!r.revision) {
      steps.push({ title: "Revision decision", status: "skipped", lines: ["No revision was written, so no rescore call was made. The original stands."] });
    } else if (!r.revision.candidate) {
      steps.push({
        title: "Revision decision",
        status: "failed",
        lines: ["The revision failed our format checks, so it wasn't rescored. The original stands."],
      });
    } else {
      const failed = r.decision.checks.filter((c) => !c.passed).map((c) => c.rule);
      steps.push({
        title: "Rescore and revision decision",
        status: "done",
        lines: [
          ran.has("rescore") ? "A separate rescore call judged the revision and whether the original evidence still applies." : "",
          r.decision.outcome === "kept-revised"
            ? `Kept the revision: every rule passed (Concept Score gain ${r.decision.gain?.toFixed(1)}).`
            : `Kept the original. Failed: ${failed.join("; ")}.`,
        ].filter(Boolean),
      });
    }
  }
  return steps;
}

const MARK: Record<Step["status"], string> = { done: "✓", skipped: "–", failed: "✕", flag: "!" };

export function DecisionTrace({ spark }: { spark: HypothesisSpark }) {
  const steps = buildTrace(spark);
  const research = spark.research.status === "verified" ? spark.research.ledger.researchUsage : undefined;
  const creative = spark.generation;
  const total = creative.estimatedCostUsd + (research?.estimatedCostUsd ?? 0);
  return (
    <details className="group border border-line">
      <summary className="readout flex cursor-pointer list-none justify-between gap-2 p-3 font-bold">
        <span>Decision trace · what actually happened</span>
        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-3">
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={`${step.title}-${i}`} className="flex gap-3">
              <span
                aria-hidden
                className={`font-mono text-[13px] font-bold ${step.status === "failed" ? "text-ember" : step.status === "done" ? "text-hypo" : "text-ink-soft"}`}
              >
                [{MARK[step.status]}]
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="readout font-bold">
                  {String(i + 1).padStart(2, "0")} · {step.title}
                  <span className="sr-only"> ({step.status})</span>
                </p>
                {step.lines.map((line) => (
                  <p key={line} className="text-[13px] leading-relaxed break-words">
                    {line}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <p className="readout text-ink-soft">
          Calls that ran: {[...(research?.calls.map((c) => c.step) ?? []), ...creative.calls.map((c) => c.step)].join(" → ")} ·{" "}
          {research ? `${plural(research.webSearches, "web search", "web searches")} · ` : ""}≈${total.toFixed(3)} estimated
        </p>
      </div>
    </details>
  );
}
