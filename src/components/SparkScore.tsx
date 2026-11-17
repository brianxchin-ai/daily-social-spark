import { CRITERIA, formatScore, type EvidenceStatus } from "@/lib/evaluation/scoring";
import type { CandidateEvaluation } from "@/lib/types";

const STATUS_LINE: Record<EvidenceStatus, string> = {
  "evidence-backed": "Trend confirmed by dated sources",
  "partially-evidenced": "Trend partly confirmed",
  "unverified-hypothesis": "Trend not yet confirmed",
};

/** Five segments, filled to the score. Dashed when the score is an assumed placeholder. */
function Bar({ value, assumed }: { value: number; assumed: boolean }) {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-2 flex-1 ${
            n > value ? "bg-line" : assumed ? "border-[1.5px] border-dashed border-hypo" : "bg-ink"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * One score for the recommendation: the score that ranked it, over all seven
 * weighted criteria. When part of it is an assumed placeholder, the caption
 * says so. The per-criterion breakdown stays closed until someone asks.
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
  const assumed = new Set(score.placeholders);
  const measured = CRITERIA.length - assumed.size;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-1.5 border-2 border-ink px-4 py-3.5">
      <p className="headline text-[64px] tabular-nums sm:text-[72px]">
        {formatScore(score.rankingScore)}
        <span className="text-[0.38em] text-ink-soft">/100</span>
      </p>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-bold">{STATUS_LINE[score.status]}</p>
        <p className="readout text-hypo">
          ◇ Based on {measured} of {CRITERIA.length} criteria
          {assumed.size > 0 ? ` · ${assumed.size} assumed` : ""}
        </p>
      </div>

      <details className="group col-span-2 mt-2 border-t border-line pt-2">
        <summary className="readout flex cursor-pointer list-none items-center justify-between gap-2 py-1 font-bold">
          See how it scored
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        </summary>
        <ul className="mt-3 flex flex-col gap-3">
          {CRITERIA.map((c) => {
            const r = results.find((x) => x.criterionId === c.id);
            const isAssumed = assumed.has(c.id);
            const value = r?.status === "scored" && r.score !== null ? r.score : isAssumed ? 3 : 0;
            return (
              <li key={c.id} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_40px_64px] items-center gap-2.5 text-[13.5px]">
                  <span>{c.name}</span>
                  <span className="readout text-right text-ink-soft">{Math.round(c.weight * 100)}%</span>
                  <Bar value={value} assumed={isAssumed} />
                </div>
                {r?.rationale && (
                  <p className="text-[12.5px] leading-snug text-ink-soft">
                    {isAssumed ? "Assumed 3 of 5. " : ""}
                    {r.rationale}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {assumed.size > 0 && (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
            <span className="text-hypo">Dashed bars</span> are assumed. The research couldn’t confirm them from dated
            sources, so each is held at a neutral 3 of 5 so the ideas can still be ranked fairly.
          </p>
        )}
        <div className="mt-3 flex justify-between gap-3 border-t border-dashed border-line pt-2 text-[13.5px]">
          <span>Creative strength only (the five craft criteria)</span>
          <strong className="tabular-nums">{formatScore(score.conceptScore)}/100</strong>
        </div>
        {revisedFrom !== undefined && (
          <p className="mt-2 text-[13px] text-ink-soft">
            ↻ Revised once by the editor: {formatScore(revisedFrom)} → {formatScore(score.rankingScore)}.
          </p>
        )}
      </details>
    </div>
  );
}
