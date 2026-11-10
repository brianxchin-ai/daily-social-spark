import { CRITERIA, formatScore, type CriterionResult } from "@/lib/evaluation/scoring";
import type { Candidate, CandidateEvaluation, EvaluationReport } from "@/lib/types";

const AUDIO_LABEL: Record<Candidate["audioRole"], string> = {
  "audio-led": "Audio-led",
  "audio-optional": "Audio optional",
  "no-audio": "No audio needed",
};

/**
 * The evaluation, laid out for inspection: every candidate × every criterion,
 * with weights, the Concept Score our code calculated, and the evaluator's
 * one-line rationale behind each score.
 */
export function Scoreboard({
  report,
  candidates,
}: {
  report: EvaluationReport;
  candidates: Candidate[];
}) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const columns = report.evaluations;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        <strong className="text-ink">Provisional ranking by Concept Score.</strong> Five of seven criteria (50% of the
        framework), judged from the idea itself by a separate reviewer call, then weighted and ranked by our code.
        Cultural relevance and emerging momentum stay unverified until live research.
        <span className="sm:hidden"> (Shown as ◇ N/V: not verified.)</span>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="readout w-[42%] py-2 pr-2 font-bold text-ink-soft sm:w-[40%]">
                Criterion
              </th>
              {columns.map((e) => (
                <th key={e.candidateId} scope="col" className="readout px-1 py-2 text-center font-bold">
                  <span className={e.score.rejected ? "text-ink-soft" : "text-ember"}>
                    {e.score.rank ? `#${e.score.rank}` : "✕"}
                  </span>
                  <span className="block truncate font-normal text-ink-soft normal-case">
                    {byId.get(e.candidateId)?.trendName}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map((criterion) => (
              <tr key={criterion.id} className="border-b border-line">
                <th scope="row" className="py-2 pr-2 align-top font-normal">
                  <span className="block text-[13px] leading-tight font-semibold">{criterion.name}</span>
                  <span className="readout text-ink-soft">{Math.round(criterion.weight * 100)}%</span>
                </th>
                {columns.map((e) => (
                  <td key={e.candidateId} className="px-1 py-2 text-center align-middle">
                    <ScoreCell result={e.results.find((r) => r.criterionId === criterion.id)!} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink">
              <th scope="row" className="py-3 pr-2 align-top">
                <span className="block text-[13px] leading-tight font-bold">Concept Score</span>
                <span className="readout text-ink-soft">Provisional · /100</span>
              </th>
              {columns.map((e) => (
                <td key={e.candidateId} className="px-1 py-3 text-center">
                  <span
                    className={`headline text-[32px] ${e.score.rejected ? "text-ink-soft line-through decoration-2" : ""}`}
                    title={`Exact: ${e.score.applicableScore.toFixed(2)}`}
                  >
                    {formatScore(e.score.applicableScore)}
                  </span>
                  <span className={`readout block ${e.score.rejected ? "text-ink-soft" : "text-hypo"}`}>
                    {e.score.rejected ? "Rejected" : e.score.rank === 1 ? "Leading" : "Ranked"}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <p className="readout font-bold">Candidates and scoring rationale</p>
        {columns.map((e) => {
          const candidate = byId.get(e.candidateId);
          return candidate ? <CandidateDetails key={e.candidateId} evaluation={e} candidate={candidate} /> : null;
        })}
      </div>

      <p className="readout text-ink-soft">
        Score = weighted average of the 1–5 scores, mapped to 0–100. Rejected if below 50, if brand + platform fit
        scores 1, or if an audio-led idea has fewer than 3 meaningful alternatives. Ties break on remixability,
        then comprehension, audio portability, fit, cross-platform. Evaluator saw candidates anonymized and shuffled.
      </p>
    </div>
  );
}

function ScoreCell({ result }: { result: CriterionResult }) {
  if (result.status === "unverified") {
    return (
      <span
        className="readout inline-block rounded-sm border border-dashed border-hypo/70 px-1 py-0.5 text-[10px] text-hypo"
        title={result.rationale}
      >
        <span aria-hidden className="sm:hidden">◇ N/V</span>
        <span className="sr-only sm:not-sr-only">Unverified</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-center gap-1" title={result.rationale}>
      <span className="font-mono text-[18px] font-bold tabular-nums">{result.score}</span>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`h-1.5 w-1.5 ${n <= (result.score ?? 0) ? "bg-ember" : "bg-line"}`} />
        ))}
      </span>
    </span>
  );
}

function CandidateDetails({ evaluation, candidate }: { evaluation: CandidateEvaluation; candidate: Candidate }) {
  const { score } = evaluation;
  return (
    <details className="group border border-line bg-canvas">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="readout text-ink-soft">
            {score.rank ? `#${score.rank}` : "Rejected"} · {candidate.trendName}
          </span>
          <span className="text-[15px] leading-snug font-semibold">{candidate.headline}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="headline text-[24px]">{formatScore(score.applicableScore)}</span>
          <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">
            ▸
          </span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        {score.rejected && (
          <div className="border-l-4 border-ink-soft pl-3">
            <p className="readout font-bold">Provisional creative rejection</p>
            <ul className="mt-1 text-[14px] leading-relaxed">
              {score.rejectionReasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[14px] leading-relaxed">{candidate.concept}</p>
        <p className="font-mono text-[11px] text-ink-soft">Mechanic: {candidate.mechanic}</p>
        <p className="font-mono text-[11px] text-ink-soft">
          Audio: {AUDIO_LABEL[candidate.audioRole]}
          {candidate.audioRole === "audio-led" &&
            ` · ${evaluation.meaningfulAudioVariations} of ${candidate.audioVariations.length} alternatives judged meaningful`}
        </p>
        <dl className="flex flex-col divide-y divide-line">
          {CRITERIA.map((criterion) => {
            const result = evaluation.results.find((r) => r.criterionId === criterion.id)!;
            return (
              <div key={criterion.id} className="flex flex-col gap-0.5 py-2">
                <dt className="readout flex justify-between gap-2">
                  <span className="font-bold">{criterion.name}</span>
                  <span className={result.status === "unverified" ? "text-hypo" : ""}>
                    {result.status === "unverified" ? "Unverified" : `${result.score}/5`}
                  </span>
                </dt>
                <dd className="text-[13px] leading-relaxed text-ink-soft">
                  {result.status === "unverified" ? `Evidence needed: ${result.rationale}` : result.rationale}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="readout text-ink-soft">
          Exact Concept Score {score.applicableScore.toFixed(2)} · Evaluator label {evaluation.evaluatorLabel}
        </p>
      </div>
    </details>
  );
}
