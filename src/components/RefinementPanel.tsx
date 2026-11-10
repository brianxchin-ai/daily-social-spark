import { CRITERIA, formatScore } from "@/lib/evaluation/scoring";
import type { Candidate, CandidateEvaluation, RefinementReport } from "@/lib/types";

/**
 * Checkpoint 4, made inspectable: the original score, the critique, the
 * revision decision, the revised score and the final selection rule.
 */
export function RefinementPanel({
  refinement,
  original,
  originalEvaluation,
}: {
  refinement: RefinementReport;
  original: Candidate;
  originalEvaluation: CandidateEvaluation;
}) {
  if (refinement.status === "skipped") return null;

  if (refinement.status === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="warn" title="Refinement could not be completed">
          {refinement.message} The {refinement.step === "editor" ? "critique" : "rescoring"} step stopped, so the
          evaluated leader is shown unrevised. Nothing was retried, and no placeholder content was used.
        </Notice>
        {refinement.critique && <CritiqueBlock critique={refinement.critique} />}
      </div>
    );
  }

  const { critique, revision, decision } = refinement;
  const revisedEval = revision?.evaluation ?? null;
  const kept = decision.outcome === "kept-revised" ? "revised" : "original";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        <strong className="text-ink">One round of notes, at most one revision.</strong> A separate editor call names
        the leading idea&apos;s biggest creative weakness. If a revision is justified, the reviewer rescores it with the
        same criteria, and our code keeps whichever version the rules favor.
      </p>

      <CritiqueBlock critique={critique} />

      {/* Decision to revise */}
      <div className="flex flex-col gap-1.5">
        <p className="readout font-bold">
          Revision justified? <span className={critique.revisionJustified ? "text-hypo" : ""}>{critique.revisionJustified ? "Yes" : "No"}</span>
        </p>
        <p className="text-[14px] leading-relaxed">{critique.decisionReason}</p>
      </div>

      {revision && revision.validationProblems.length > 0 && (
        <Notice tone="warn" title="Revision failed our format checks">
          It wasn&apos;t rescored, and the original stands. {revision.validationProblems.slice(0, 3).join(" · ")}
        </Notice>
      )}

      {revision?.candidate && revisedEval && (
        <>
          {critique.changeSummary && (
            <div className="flex flex-col gap-1.5 border-l-4 border-hypo pl-4">
              <p className="readout font-bold text-hypo">What changed</p>
              <p className="text-[14px] leading-relaxed">{critique.changeSummary}</p>
            </div>
          )}

          <BeforeAfter original={originalEvaluation} revised={revisedEval} />

          <div className="flex flex-col gap-1">
            <p className="readout font-bold">Selection rules</p>
            <ul className="flex flex-col gap-1 text-[14px] leading-relaxed">
              {decision.checks.map((c) => (
                <li key={c.rule} className="flex gap-2">
                  <span aria-hidden className={`font-mono ${c.passed ? "text-hypo" : "text-ember"}`}>
                    {c.passed ? "✓" : "✕"}
                  </span>
                  <span>
                    {c.rule}
                    <span className="sr-only">{c.passed ? " (passed)" : " (failed)"}</span>
                  </span>
                </li>
              ))}
            </ul>
            {revision.checksRationale && (
              <p className="text-[13px] leading-relaxed text-ink-soft">Reviewer on the checks: {revision.checksRationale}</p>
            )}
          </div>

          <details className="group border border-line bg-canvas">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="readout text-ink-soft">{kept === "revised" ? "Original version" : "Revised version (not used)"}</span>
                <span className="text-[15px] leading-snug font-semibold">
                  {kept === "revised" ? original.headline : revision.candidate.headline}
                </span>
              </span>
              <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">
                ▸
              </span>
            </summary>
            <p className="border-t border-line p-3 text-[14px] leading-relaxed">
              {kept === "revised" ? original.concept : revision.candidate.concept}
            </p>
          </details>
        </>
      )}

      <Outcome
        kept={kept}
        gain={decision.gain}
        minGain={decision.minGain}
        hadRevision={Boolean(revision?.candidate && revisedEval)}
        justified={critique.revisionJustified}
      />
    </div>
  );
}

function CritiqueBlock({ critique }: { critique: { weakness: string; affectedCriterion: string } }) {
  const affects = CRITERIA.find((c) => c.id === critique.affectedCriterion)?.name ?? critique.affectedCriterion;
  return (
    <div className="flex flex-col gap-1.5 border-l-4 border-ember pl-4">
      <p className="readout font-bold text-ember">Biggest creative weakness</p>
      <p className="text-[15px] leading-relaxed font-medium">{critique.weakness}</p>
      <p className="readout text-ink-soft">Affects: {affects}</p>
    </div>
  );
}

function BeforeAfter({ original, revised }: { original: CandidateEvaluation; revised: CandidateEvaluation }) {
  const concept = CRITERIA.filter((c) => c.basis === "concept");
  const scoreOf = (e: CandidateEvaluation, id: string) => e.results.find((r) => r.criterionId === id)?.score ?? null;
  const gain = revised.score.applicableScore - original.score.applicableScore;
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead>
        <tr className="border-b-2 border-ink">
          <th scope="col" className="readout w-[52%] py-2 pr-2 font-bold text-ink-soft">
            Criterion
          </th>
          <th scope="col" className="readout py-2 text-center font-bold">
            Original
          </th>
          <th scope="col" className="readout py-2 text-center font-bold">
            Revised
          </th>
        </tr>
      </thead>
      <tbody>
        {concept.map((c) => {
          const before = scoreOf(original, c.id);
          const after = scoreOf(revised, c.id);
          const delta = before !== null && after !== null ? after - before : 0;
          return (
            <tr key={c.id} className="border-b border-line">
              <th scope="row" className="py-2 pr-2 text-[13px] leading-tight font-semibold">
                {c.name} <span className="readout font-normal text-ink-soft">{Math.round(c.weight * 100)}%</span>
              </th>
              <td className="py-2 text-center font-mono text-[16px] font-bold tabular-nums">{before}</td>
              <td className="py-2 text-center font-mono text-[16px] font-bold tabular-nums" title={revised.results.find((r) => r.criterionId === c.id)?.rationale}>
                {after}
                {delta !== 0 && (
                  <span className={`ml-1 text-[11px] ${delta > 0 ? "text-hypo" : "text-ember"}`}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-ink">
          <th scope="row" className="py-3 pr-2 text-[13px] font-bold">
            Concept Score <span className="readout font-normal text-ink-soft">provisional</span>
          </th>
          <td className="py-3 text-center">
            <span className="headline text-[28px]" title={`Exact: ${original.score.applicableScore.toFixed(2)}`}>
              {formatScore(original.score.applicableScore)}
            </span>
          </td>
          <td className="py-3 text-center">
            <span
              className={`headline text-[28px] ${revised.score.rejected ? "text-ink-soft line-through decoration-2" : ""}`}
              title={`Exact: ${revised.score.applicableScore.toFixed(2)}`}
            >
              {formatScore(revised.score.applicableScore)}
            </span>
            <span className={`readout block ${gain >= 0 ? "text-hypo" : "text-ember"}`}>
              {gain >= 0 ? "+" : ""}
              {gain.toFixed(1)}
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Outcome({
  kept,
  gain,
  minGain,
  hadRevision,
  justified,
}: {
  kept: "original" | "revised";
  gain: number | null;
  minGain: number;
  hadRevision: boolean;
  justified: boolean;
}) {
  const detail = !justified
    ? "The editor judged no revision justified, so the original stands."
    : !hadRevision
      ? "The revision couldn't be scored, so the original stands."
      : kept === "revised"
        ? `The revision passed every rule, including a gain of ${gain!.toFixed(1)} against the ${minGain}-point minimum.`
        : `At least one rule failed (see above). Gain: ${gain!.toFixed(1)} against a ${minGain}-point minimum.`;
  return (
    <div className="flex flex-col gap-1 border-2 border-ink bg-night px-4 py-3 text-night-ink">
      <p className="headline text-[22px]">{kept === "revised" ? "Kept the revised version" : "Kept the original"}</p>
      <p className="readout opacity-80">{detail}</p>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warn"; title: string; children: React.ReactNode }) {
  return (
    <div role={tone === "warn" ? "status" : undefined} className="flex flex-col gap-1 border-2 border-dashed border-ink-soft p-3">
      <p className="readout font-bold">⚠ {title}</p>
      <p className="text-[14px] leading-relaxed">{children}</p>
    </div>
  );
}
