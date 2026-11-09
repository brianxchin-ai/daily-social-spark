import type { EvidenceSource, SignalStrength } from "@/lib/types";

const BARS: Record<SignalStrength, number> = { strong: 3, moderate: 2, emerging: 1 };

/**
 * Supporting sources as a monospaced source log.
 * Demo sources are shown as plain text, never as clickable links.
 */
export function EvidenceList({ sources, isDemo }: { sources: EvidenceSource[]; isDemo: boolean }) {
  return (
    <ol className="demo-outline flex flex-col divide-y divide-line bg-canvas">
      {sources.map((source, index) => (
        <li key={source.id} className="flex flex-col gap-1.5 p-3">
          <div className="readout flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
            <span className="font-bold text-ember">[{String(index + 1).padStart(2, "0")}]</span>
            <span>{source.publishedAgo}</span>
            <span className="flex items-end gap-0.5" aria-label={`${source.signal} signal`}>
              {[1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className={`w-1 ${bar <= BARS[source.signal] ? "bg-ember" : "bg-line"}`}
                  style={{ height: `${bar * 4}px` }}
                />
              ))}
              <span className="ml-1.5">{source.signal}</span>
            </span>
            {isDemo && <span className="text-demo">◆ demo source · not a real link</span>}
          </div>
          <p className="text-[15px] leading-snug font-semibold">
            {isDemo ? (
              source.title
            ) : (
              <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-ember underline-offset-4">
                {source.title}
              </a>
            )}
          </p>
          <p className="font-mono text-[11px] text-ink-soft">
            {source.outlet} — {source.note}
          </p>
        </li>
      ))}
    </ol>
  );
}
