import type { EvidenceLedger, LedgerObservation, LedgerSignal } from "@/lib/research/ledger";
import type { Candidate, HypothesisSpark } from "@/lib/types";
import { researchSummary } from "./EvidenceStatus";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-06" → "Nov 6, 2026"; "2026-11" → "Nov 2026". Display only. */
export function formatLedgerDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** Only real web links are rendered as links. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const NOVELTY_HELP: Record<LedgerSignal["novelty"], string> = {
  emerging: "A potentially distinctive new mechanism",
  evolving: "A meaningful transformation of an existing mechanism",
  derivative: "An established mechanism with a new surface variation",
  established: "Mature or widely adopted",
  uncertain: "Novelty couldn't be determined reliably",
};

/**
 * The research behind the ideas: signals, their cited observations and
 * sources, both kinds of date, novelty and lineage, what our checks decided,
 * and the gaps. Shown only when the signed ledger was verified.
 */
export function EvidencePanel({ spark }: { spark: HypothesisSpark }) {
  const summary = researchSummary(spark.research);
  if (spark.research.status !== "verified") {
    return (
      <div className="flex flex-col gap-2 border-2 border-dashed border-ink-soft p-3">
        <p className="readout font-bold">⚠ No verified research behind this result</p>
        <p className="text-[14px] leading-relaxed">{summary.text}</p>
        <p className="text-[14px] leading-relaxed text-ink-soft">
          Every idea here is an unverified creative hypothesis. Cultural relevance and momentum stay unverified, and
          nothing is presented as evidence.
        </p>
      </div>
    );
  }

  const ledger = spark.research.ledger;
  const uses = (id: string) =>
    spark.candidates.flatMap((c) =>
      c.groundedIn.includes(id) ? [`${c.trendName} (direct)`] : c.contextIn.includes(id) ? [`${c.trendName} (context)`] : [],
    );
  const used = ledger.signals.filter((s) => uses(s.id).length > 0);
  const others = ledger.signals.filter((s) => uses(s.id).length === 0);
  const setAside = ledger.sources.filter((s) => s.setAside);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        <strong className="text-ink">{summary.text}</strong> Sources come only from what the search actually returned,
        and quotes are verbatim. A <em>publication date</em> says when something was reported; only a{" "}
        <em>behavior date</em> written in a source counts toward recency, and only a dated, quoted increase counts as
        momentum.
      </p>

      {used.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="readout font-bold">Signals behind the ideas</p>
          {used.map((s) => (
            <SignalCard key={s.id} signal={s} ledger={ledger} usedBy={uses(s.id)} open={s.id === used[0].id} />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <details className="group border border-line">
          <summary className="readout flex cursor-pointer list-none justify-between gap-2 p-3 font-bold">
            <span>Other signals found ({others.length}), not used</span>
            <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3">
            {others.map((s) => (
              <SignalCard key={s.id} signal={s} ledger={ledger} usedBy={[]} open={false} />
            ))}
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="readout font-bold">Gaps and limitations</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed">
            {ledger.gaps.length ? ledger.gaps.map((g) => <li key={g}>{g}</li>) : <li>None reported.</li>}
            <li>No platform analytics: the research sees public web pages, not TikTok, Instagram or YouTube data.</li>
          </ul>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="readout font-bold">What our checks changed</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed">
            {ledger.adjustments.length ? ledger.adjustments.map((a) => <li key={a}>{a}</li>) : <li>Nothing needed changing.</li>}
            {setAside.map((s) => (
              <li key={s.id}>Set aside {s.domain}: it contained instructions aimed at AI systems.</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SignalCard({
  signal,
  ledger,
  usedBy,
  open,
}: {
  signal: LedgerSignal;
  ledger: EvidenceLedger;
  usedBy: string[];
  open: boolean;
}) {
  const observations = signal.observationIds.map((id) => ledger.observations.find((o) => o.id === id)!);
  const inferences = ledger.inferences.filter((i) => i.signalId === signal.id);
  return (
    <details className="group border border-line bg-canvas" open={open}>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="readout text-ink-soft">
            {signal.id} · {signal.category} · {signal.categoryRelation}
          </span>
          <span className="text-[15px] leading-snug font-semibold">{signal.name}</span>
          <span className="readout text-[10px]">
            <span className="text-hypo" title={NOVELTY_HELP[signal.novelty]}>
              Novelty: {signal.novelty}
            </span>
            <span className="text-ink-soft"> · {observations.length} observation{observations.length === 1 ? "" : "s"}</span>
            {usedBy.length > 0 && <span className="text-ink-soft"> · used by {usedBy.join(", ")}</span>}
          </span>
        </span>
        <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <p className="text-[14px] leading-relaxed">{signal.summary}</p>

        <dl className="grid grid-cols-1 gap-2 text-[13px] leading-relaxed sm:grid-cols-2">
          <div>
            <dt className="readout font-bold">Lineage · scout’s assessment</dt>
            <dd>{signal.lineage ?? "None identified"}{signal.whatIsNew ? `. New: ${signal.whatIsNew}` : ""}</dd>
            <dd className="text-ink-soft">
              {signal.noveltyChecked && signal.lineageQuery
                ? `✓ Lineage search run: “${signal.lineageQuery}”`
                : "Lineage not checked with a recorded search"}
            </dd>
          </div>
          <div>
            <dt className="readout font-bold">Evidence bar</dt>
            <dd>
              Cultural relevance:{" "}
              {signal.culturalRelevance.status === "eligible"
                ? `met (score capped at ${signal.culturalRelevance.maxScore})`
                : `not met: ${signal.culturalRelevance.reason}`}
            </dd>
            <dd>
              Momentum:{" "}
              {signal.momentum.status === "eligible" ? `met (score capped at ${signal.momentum.maxScore})` : `not met: ${signal.momentum.reason}`}
            </dd>
          </div>
        </dl>

        {observations.length === 0 ? (
          <p className="border-2 border-dashed border-ink-soft p-2 text-[13px] leading-relaxed">
            ⚠ No validated observations. This signal can inspire an idea, but it isn’t direct supporting evidence.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {observations.map((o) => (
              <ObservationItem key={o.id} observation={o} ledger={ledger} />
            ))}
          </ul>
        )}

        {inferences.length > 0 && (
          <div className="flex flex-col gap-1 border-l-4 border-line pl-3">
            <p className="readout font-bold text-ink-soft">Interpretation · not evidence</p>
            <ul className="flex flex-col gap-1 text-[13px] leading-relaxed text-ink-soft">
              {inferences.map((i) => (
                <li key={i.statement}>
                  {i.statement}
                  {i.basis !== "scout" && (
                    <span className="readout"> ({i.basis === "uncited" ? "uncited claim, downgraded" : "figure not in its quote, downgraded"})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {signal.creativeOpportunity && (
          <p className="text-[13px] leading-relaxed text-ink-soft">Scout’s creative hypothesis: {signal.creativeOpportunity}</p>
        )}
      </div>
    </details>
  );
}

function ObservationItem({ observation: o, ledger }: { observation: LedgerObservation; ledger: EvidenceLedger }) {
  const citations = o.citationIds.map((id) => ledger.citations.find((c) => c.id === id)!);
  return (
    <li className="flex flex-col gap-1.5 border-l-4 border-hypo pl-3">
      <p className="readout">
        <span className="font-bold">{o.id} · {o.kind === "growth" ? "Reports an increase" : "Reports it is happening"}</span>
        {o.owned && <span className="text-ink-soft"> · platform- or brand-owned, not independent</span>}
      </p>
      <p className="text-[14px] leading-relaxed">{o.statement}</p>
      <p className="readout text-[10px] text-ink-soft">
        Behavior date: {o.behavior.status === "known" ? formatLedgerDate(o.behavior.date) : "unknown"}
        {" · "}
        Published:{" "}
        {o.published ? `${formatLedgerDate(o.published.date)}${o.published.shared ? " (dateline from the same article)" : ""}` : "not stated"}
      </p>
      {citations.map((c) => {
        const source = ledger.sources.find((s) => s.id === c.sourceId)!;
        const href = safeHref(source.url);
        return (
          <figure key={c.id} className="flex flex-col gap-1">
            <blockquote className="text-[13px] leading-relaxed italic">“{c.quote}”</blockquote>
            <figcaption className="readout text-[10px] text-ink-soft">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-ink">
                  {source.title || source.domain}
                </a>
              ) : (
                source.title || source.domain
              )}{" "}
              · {source.domain}
              {source.pageUpdated && ` · page updated ${source.pageUpdated} (not a behavior date)`}
            </figcaption>
          </figure>
        );
      })}
    </li>
  );
}

export function usedSignalCount(candidates: Candidate[]): number {
  return new Set(candidates.flatMap((c) => [...c.groundedIn, ...c.contextIn])).size;
}
