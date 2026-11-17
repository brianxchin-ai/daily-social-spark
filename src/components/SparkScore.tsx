import { CRITERIA, formatScore } from "@/lib/evaluation/scoring";
import type { CandidateEvaluation } from "@/lib/types";
import { RelevanceBadge } from "./EvidenceStatus";

const JUDGED_FROM = {
  research: "Judged from this scan's research.",
  "general-knowledge": "Judged from general cultural knowledge.",
  both: "Judged from this scan's research and general cultural knowledge.",
} as const;

/** Five segments, filled to the score. */
function Bar({ value }: { value: number }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-2 flex-1 ${n > value ? "bg-line" : "bg-ink"}`} />
      ))}
    </span>
  );
}

/**
 * One score for the recommendation: the Spark Score over all six weighted
 * criteria. Cultural relevance is AI judgment unless the research verified
 * it; the label says which. The per-criterion breakdown stays closed until
 * someone asks.
 */
export function SparkScore({
  evaluation,
  revisedFrom,
}: {
  evaluation: CandidateEvaluation;
  /** The original winner's score, when the editor's revision replaced it. */
  revisedFrom?: number;
}) {
  const { score, results } = evaluation;
  const relevance = results.find((r) => r.criterionId === "culturalRelevance");
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-1.5 border-2 border-ink px-4 py-3.5">
      <p className="headline text-[64px] tabular-nums sm:text-[72px]">
        {formatScore(score.rankingScore)}
        <span className="text-[0.38em] text-ink-soft">/100</span>
      </p>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-bold">
          {score.relevanceVerified ? "Cultural relevance verified by research" : "Cultural relevance is AI judgment"}
        </p>
        <p className="readout text-hypo">◇ Scored on all {CRITERIA.length} criteria</p>
      </div>

      <details className="group col-span-2 mt-2 border-t border-line pt-2">
        <summary className="readout flex cursor-pointer list-none items-center justify-between gap-2 py-1 font-bold">
          See how it scored
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        </summary>
        <ul className="mt-3 flex flex-col gap-3">
          {CRITERIA.map((c) => {
            const r = results.find((x) => x.criterionId === c.id);
            return (
              <li key={c.id} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_40px_64px] items-center gap-2.5 text-[13.5px]">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {c.name}
                    {c.id === "culturalRelevance" && <RelevanceBadge verified={score.relevanceVerified} />}
                  </span>
                  <span className="readout text-right text-ink-soft">{Math.round(c.weight * 100)}%</span>
                  <Bar value={r?.score ?? 0} />
                </div>
                {r?.rationale && (
                  <p className="text-[12.5px] leading-snug text-ink-soft">
                    {r.rationale}
                    {c.id === "culturalRelevance" && relevance?.judgedFrom ? ` ${JUDGED_FROM[relevance.judgedFrom]}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {evaluation.makeableNote && (
          <p className="mt-3 border-t border-dashed border-line pt-2 text-[13px] leading-relaxed">
            <span className="font-semibold">✓ Makeable on a phone in a day.</span>{" "}
            <span className="text-ink-soft">{evaluation.makeableNote}</span>
          </p>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          Every criterion is scored by the AI reviewer, 1 to 5. Cultural relevance is marked{" "}
          <span className="text-hypo">verified</span> only when a cited, dated source from this scan’s research shows
          the behavior is live; the label never changes the score.
        </p>
        {revisedFrom !== undefined && (
          <p className="mt-2 text-[13px] text-ink-soft">
            ↻ Revised once by the editor: {formatScore(revisedFrom)} → {formatScore(score.rankingScore)}.
          </p>
        )}
      </details>
    </div>
  );
}
