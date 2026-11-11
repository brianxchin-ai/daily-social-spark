import {
  CRITERIA,
  explainTies,
  formatScore,
  NEUTRAL_PLACEHOLDER,
  TIE_BREAK_ORDER,
  criterion as criterionOf,
  type CriterionResult,
  type TieExplanation,
} from "@/lib/evaluation/scoring";
import type { Candidate, CandidateEvaluation, EvaluationReport } from "@/lib/types";
import { STATUS_LABEL, StatusBadge } from "./EvidenceStatus";

const AUDIO_LABEL: Record<Candidate["audioRole"], string> = {
  "audio-led": "Audio-led",
  "audio-optional": "Audio optional",
  "no-audio": "No audio needed",
};

export function computeTies(report: EvaluationReport): TieExplanation[] {
  return explainTies(
    report.evaluations.map((e) => e.score),
    new Map(report.evaluations.map((e) => [e.candidateId, e.results])),
  );
}

/** Plain-English account of how a tie was broken. */
export function tieSentence(tie: TieExplanation, name: (id: string) => string): string {
  const how =
    tie.decidedBy === "generation-order"
      ? "every tie-break score was also equal, so the order the ideas were generated in decided it"
      : `our fixed tie-break order put “${name(tie.ahead)}” ahead on ${criterionOf(tie.decidedBy.criterionId).name.toLowerCase()}, ${tie.decidedBy.ahead} vs. ${tie.decidedBy.behind}`;
  return `“${name(tie.ahead)}” and “${name(tie.behind)}” both scored ${formatScore(tie.score)}. This is a tie, not a decisive win: ${how}.`;
}

/** Short form for the verdict strip, from the leader's side. */
export function tieShort(tie: TieExplanation, name: (id: string) => string): string {
  const how =
    tie.decidedBy === "generation-order"
      ? "on generation order (all tie-break scores equal)"
      : `on the ${criterionOf(tie.decidedBy.criterionId).name.toLowerCase()} tie-break (${tie.decidedBy.ahead} vs. ${tie.decidedBy.behind})`;
  return `Tied at ${formatScore(tie.score)} with “${name(tie.behind)}”; ranked first ${how}, not a decisive win.`;
}

/**
 * The evaluation, laid out for inspection: every candidate × all seven
 * criteria, which scores were verified, which were assumed for ranking, both
 * scores our code calculated, each status, and how any tie was broken.
 */
export function Scoreboard({
  report,
  candidates,
  revisedFrom,
}: {
  report: EvaluationReport;
  candidates: Candidate[];
  /** Set when the recommendation is a revision of this original candidate. */
  revisedFrom?: string;
}) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const columns = report.evaluations;
  const ties = computeTies(report);
  const tiedIds = new Set(ties.flatMap((t) => [t.ahead, t.behind]));
  const anyProvisional = columns.some((e) => e.score.provisional);
  const name = (id: string) => byId.get(id)?.trendName ?? id;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        <strong className="text-ink">Ranked by our code on all seven weighted criteria.</strong>
        {anyProvisional && (
          <>
            {" "}
            <strong className="text-ink">◇ {NEUTRAL_PLACEHOLDER}</strong> marks an unverified evidence criterion, assumed
            for ranking only, so totals are Provisional Ranking Scores.
          </>
        )}
      </p>
      {revisedFrom && (
        <p className="border-l-4 border-ink pl-3 text-[13px] leading-relaxed">
          These are the three <strong>original</strong> ideas. The recommendation at the top is a revised version of
          “{name(revisedFrom)},” rescored separately; its scores are in Refinement.
        </p>
      )}

      {ties.map((tie) => (
        <div key={`${tie.ahead}-${tie.behind}`} role="note" className="flex flex-col gap-1 border-2 border-ink bg-canvas px-4 py-3">
          <p className="readout font-bold">= Tied result</p>
          <p className="text-[14px] leading-relaxed">{tieSentence(tie, name)}</p>
          <p className="readout text-ink-soft">Compare the tied ideas below and in “The three ideas.”</p>
        </div>
      ))}

      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-ink">
              <th scope="col" className="readout w-[34%] py-2 pr-2 font-bold text-ink-soft sm:w-[36%]">
                Criterion
              </th>
              {columns.map((e) => (
                <th key={e.candidateId} scope="col" className="readout px-1 py-2 text-center font-bold">
                  <span className={e.score.rejected ? "text-ink-soft" : "text-ember"}>
                    {e.score.rank ? `#${e.score.rank}` : "✕"}
                    {tiedIds.has(e.candidateId) && <span className="text-ink"> =tie</span>}
                  </span>
                  <span className="block truncate font-normal text-ink-soft normal-case" title={name(e.candidateId)}>
                    {name(e.candidateId)}
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
                  <span className="readout text-ink-soft">
                    {Math.round(criterion.weight * 100)}%{criterion.basis === "evidence" ? " · evidence" : ""}
                  </span>
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
                <span className="block text-[13px] leading-tight font-bold">
                  {anyProvisional ? "Provisional Ranking Score" : "Ranking Score"}
                </span>
                <span className="readout text-ink-soft">All 7 · /100 · decides rank</span>
              </th>
              {columns.map((e) => (
                <td key={e.candidateId} className="px-1 py-3 text-center">
                  <span
                    className={`headline text-[30px] ${e.score.rejected ? "text-ink-soft line-through decoration-2" : ""}`}
                    title={`Exact: ${e.score.rankingScore.toFixed(2)}`}
                  >
                    {formatScore(e.score.rankingScore)}
                  </span>
                  {e.score.provisional && <span className="readout block text-hypo">Provisional</span>}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-2 pr-2 align-top">
                <span className="block text-[13px] leading-tight font-bold">Concept Score</span>
                <span className="readout text-ink-soft">5 creative · /100</span>
              </th>
              {columns.map((e) => (
                <td key={e.candidateId} className="px-1 py-2 text-center">
                  <span className="font-mono text-[18px] font-bold tabular-nums" title={`Exact: ${e.score.conceptScore.toFixed(2)}`}>
                    {formatScore(e.score.conceptScore)}
                  </span>
                  {e.score.rejected && <span className="readout block text-ink-soft">Rejected</span>}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="py-2 pr-2 align-top text-[13px] font-bold">
                Evidence status
              </th>
              {columns.map((e) => (
                <td key={e.candidateId} className="px-1 py-2 text-center text-[11px] leading-tight font-semibold">
                  <span className="hidden sm:inline">{STATUS_LABEL[e.score.status]}</span>
                  <span className="sm:hidden">{SHORT_STATUS[e.score.status]}</span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <p className="readout font-bold">Scoring rationale, idea by idea</p>
        {columns.map((e) => {
          const candidate = byId.get(e.candidateId);
          return candidate ? (
            <CandidateDetails key={e.candidateId} evaluation={e} candidate={candidate} tied={tiedIds.has(e.candidateId)} />
          ) : null;
        })}
      </div>

      <details className="group border border-line">
        <summary className="readout flex cursor-pointer list-none justify-between gap-2 p-3 font-bold">
          <span>How this was scored</span>
          <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div className="flex flex-col gap-2 border-t border-line p-3 text-[13px] leading-relaxed text-ink-soft">
          <p>
            A separate reviewer scored each idea 1–5 on every criterion, seeing the ideas anonymized and shuffled. Our
            code does all the arithmetic: a weighted average mapped to 0–100.
          </p>
          <p>
            Cultural relevance and momentum count only when cited, behavior-dated evidence passed our checks (✓), capped
            by the strength of that evidence. Otherwise they count as a neutral ◇ {NEUTRAL_PLACEHOLDER}, an assumption for
            ranking, not a measured score, and the total is a Provisional Ranking Score.
          </p>
          <p>
            The Concept Score covers the five creative criteria. Brand/category + platform fit takes the lower of its two
            parts (shown as B·P).
          </p>
          <p>
            An idea is rejected if its Concept Score is below 50, its fit scores 1, or it is audio-led with fewer than 3
            meaningful alternatives. Ties break on{" "}
            {TIE_BREAK_ORDER.map((id) => criterionOf(id).name.toLowerCase()).join(", then ")}.
          </p>
        </div>
      </details>
    </div>
  );
}

const SHORT_STATUS = {
  "evidence-backed": "✓ Evidence",
  "partially-evidenced": "◐ Partial",
  "unverified-hypothesis": "◇ Unverified",
} as const;

function ScoreCell({ result }: { result: CriterionResult }) {
  if (result.status === "unverified") {
    return (
      <span
        className="readout inline-flex flex-col items-center rounded-sm border border-dashed border-hypo/70 px-1 py-0.5 text-[10px] text-hypo"
        title={`Unverified: ${result.rationale}`}
      >
        <span className="font-mono text-[15px] font-bold">◇ {NEUTRAL_PLACEHOLDER}</span>
        <span>assumed</span>
        <span className="sr-only">Unverified; counted as {NEUTRAL_PLACEHOLDER} for ranking only. {result.rationale}</span>
      </span>
    );
  }
  const verified = result.criterionId === "culturalRelevance" || result.criterionId === "emergingMomentum";
  return (
    <span className="inline-flex flex-col items-center gap-1" title={result.rationale}>
      <span className="font-mono text-[18px] font-bold tabular-nums">
        {result.score}
        {verified && <span className="ml-0.5 text-[11px] text-hypo">✓</span>}
      </span>
      {result.parts ? (
        <span className="readout text-[9px] text-ink-soft" title="Brand fit · platform fit">
          B{result.parts.brand}·P{result.parts.platform}
        </span>
      ) : (
        <span className="flex gap-0.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`h-1.5 w-1.5 ${n <= (result.score ?? 0) ? "bg-ember" : "bg-line"}`} />
          ))}
        </span>
      )}
      {verified && <span className="sr-only">Verified from cited evidence.</span>}
    </span>
  );
}

function CandidateDetails({
  evaluation,
  candidate,
  tied,
}: {
  evaluation: CandidateEvaluation;
  candidate: Candidate;
  tied: boolean;
}) {
  const { score } = evaluation;
  return (
    <details className="group border border-line bg-canvas">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="readout text-ink-soft">
            {score.rank ? `#${score.rank}${tied ? " · tied" : ""}` : "Rejected"} · {candidate.trendName}
          </span>
          <span className="text-[15px] leading-snug font-semibold">{candidate.headline}</span>
          <StatusBadge status={score.status} />
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex flex-col items-end">
            <span className="headline text-[24px]">{formatScore(score.rankingScore)}</span>
            <span className="readout text-[9px] text-ink-soft">{score.provisional ? "Provisional" : "Ranking"}</span>
          </span>
          <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">
            ▸
          </span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        {score.rejected && (
          <div className="border-l-4 border-ink-soft pl-3">
            <p className="readout font-bold">Rejected by our rules</p>
            <ul className="mt-1 text-[14px] leading-relaxed">
              {score.rejectionReasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="font-mono text-[11px] text-ink-soft">
          Audio: {AUDIO_LABEL[candidate.audioRole]}
          {candidate.audioRole === "audio-led" &&
            ` · ${evaluation.meaningfulAudioVariations} of ${candidate.audioVariations.length} alternatives judged meaningful`}
        </p>
        <dl className="flex flex-col divide-y divide-line">
          {CRITERIA.map((criterion) => {
            const result = evaluation.results.find((r) => r.criterionId === criterion.id)!;
            const unverified = result.status === "unverified";
            return (
              <div key={criterion.id} className="flex flex-col gap-0.5 py-2">
                <dt className="readout flex justify-between gap-2">
                  <span className="font-bold">{criterion.name}</span>
                  <span className={unverified ? "text-hypo" : ""}>
                    {unverified
                      ? `Unverified · ◇ ${NEUTRAL_PLACEHOLDER} assumed`
                      : `${result.score}/5${criterion.basis === "evidence" ? " ✓ verified" : ""}`}
                  </span>
                </dt>
                <dd className="text-[13px] leading-relaxed text-ink-soft">
                  {unverified ? `Why unverified: ${result.rationale}` : result.rationale}
                  {result.observationIds?.length ? ` (Evidence: ${result.observationIds.join(", ")})` : ""}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="readout text-ink-soft">
          Exact: ranking {score.rankingScore.toFixed(2)} · concept {score.conceptScore.toFixed(2)}
          {score.placeholders.length > 0 && ` · ${score.placeholders.length} placeholder(s)`} · reviewer label{" "}
          {evaluation.evaluatorLabel}
        </p>
      </div>
    </details>
  );
}
