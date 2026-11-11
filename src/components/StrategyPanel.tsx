import type { EvidenceLedger } from "@/lib/research/ledger";
import type { Candidate, CandidateEvaluation } from "@/lib/types";

/** Split the combined fit rationale ("Brand 5/5: … Platform 4/5: …") back into its two judgments. */
export function fitParts(evaluation: CandidateEvaluation | undefined) {
  const fit = evaluation?.results.find((r) => r.criterionId === "brandPlatformFit");
  if (!fit?.parts) return null;
  const m = fit.rationale.match(/^Brand \d\/5: ([\s\S]*?) Platform \d\/5: ([\s\S]*)$/);
  return { brand: fit.parts.brand, platform: fit.parts.platform, brandWhy: m?.[1] ?? "", platformWhy: m?.[2] ?? "" };
}

/**
 * Why an idea could work, with its parts kept honest: what the evidence
 * shows (direct vs. context), what the AI inferred, and what is a hypothesis.
 */
export function StrategyPanel({
  candidate,
  evaluation,
  ledger,
  brand,
  platformLabel,
}: {
  candidate: Candidate;
  evaluation?: CandidateEvaluation;
  ledger: EvidenceLedger | null;
  brand: string;
  platformLabel: string;
}) {
  const signal = (id: string) => ledger?.signals.find((s) => s.id === id);
  const fit = fitParts(evaluation);
  const warnings = candidate.groundingWarnings ?? [];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="readout text-ink-soft">Creative territory</dt>
          <dd className="text-[15px] leading-snug font-semibold">{candidate.territory}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="readout text-ink-soft">Underlying mechanic</dt>
          <dd className="text-[15px] leading-snug">{candidate.mechanic}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <p className="readout font-bold">Cultural inspiration</p>
        {candidate.groundedIn.length === 0 && candidate.contextIn.length === 0 ? (
          <p className="text-[14px] leading-relaxed text-ink-soft">
            Not built on a researched signal: a creative hypothesis from general knowledge.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[14px] leading-relaxed">
            {candidate.groundedIn.map((id) => {
              const s = signal(id);
              const empty = s && s.observationIds.length === 0;
              return (
                <li key={id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`readout font-bold ${empty ? "text-ink-soft" : "text-hypo"}`}>
                    {empty ? "Inspiration only" : "Direct evidence"}
                  </span>
                  <span>
                    {id} · {s?.name ?? "unknown signal"}
                    {s && <span className="text-ink-soft"> ({s.novelty}, {s.categoryRelation})</span>}
                  </span>
                </li>
              );
            })}
            {candidate.contextIn.map((id) => (
              <li key={id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="readout font-bold text-ink-soft">Context only, not proof</span>
                <span>
                  {id} · {signal(id)?.name ?? "unknown signal"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 border-2 border-dashed border-ink-soft p-2 text-[13px] leading-relaxed">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 border-l-4 border-ember pl-4">
          <p className="readout font-bold">
            Why it could work for {brand}
            {fit && <span className="font-normal text-ink-soft"> · brand fit {fit.brand}/5</span>}
          </p>
          <p className="text-[14px] leading-relaxed">{fit?.brandWhy || candidate.creativeLeap}</p>
        </div>
        <div className="flex flex-col gap-1.5 border-l-4 border-ember pl-4">
          <p className="readout font-bold">
            Built for {platformLabel}
            {fit && <span className="font-normal text-ink-soft"> · platform fit {fit.platform}/5</span>}
          </p>
          <p className="text-[14px] leading-relaxed">{candidate.platformExecution}</p>
          {fit?.platformWhy && <p className="text-[13px] leading-relaxed text-ink-soft">Reviewer: {fit.platformWhy}</p>}
        </div>
      </div>

      <dl className="flex flex-col divide-y divide-line border border-line">
        <div className="flex flex-col gap-1 p-3">
          <dt className="readout font-bold text-hypo">What the evidence shows · writer’s summary, checked against the ledger</dt>
          <dd className="text-[14px] leading-relaxed">{candidate.evidenceBasis}</dd>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <dt className="readout font-bold">The creative leap · AI interpretation</dt>
          <dd className="text-[14px] leading-relaxed">{candidate.creativeLeap}</dd>
        </div>
        <div className="flex flex-col gap-1 p-3">
          <dt className="readout font-bold text-ink-soft">Execution hypothesis · speculative</dt>
          <dd className="text-[14px] leading-relaxed">{candidate.executionHypothesis}</dd>
        </div>
      </dl>
    </div>
  );
}
