import type { EvidenceSource, SignalStrength } from "@/lib/types";

const SIGNAL_DOTS: Record<SignalStrength, number> = { strong: 3, moderate: 2, emerging: 1 };

/**
 * Supporting sources, styled like footnotes.
 * Demo sources are shown as plain text, never as clickable links.
 */
export function EvidenceList({ sources, isDemo }: { sources: EvidenceSource[]; isDemo: boolean }) {
  return (
    <ol className="flex flex-col">
      {sources.map((source, index) => (
        <li
          key={source.id}
          className="grid grid-cols-[2rem_1fr] gap-x-2 border-b border-rule py-4 first:pt-0 last:border-b-0"
        >
          <span className="font-serif text-[22px] leading-none text-accent">{index + 1}</span>
          <div className="flex flex-col gap-1.5">
            <p className="text-[17px] leading-snug font-semibold">
              {isDemo ? (
                source.title
              ) : (
                <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-accent underline-offset-4">
                  {source.title}
                </a>
              )}
            </p>
            <p className="eyebrow flex flex-wrap items-center gap-x-2 text-[10px] text-ink-soft">
              <span>{source.outlet}</span>
              <span aria-hidden>/</span>
              <span>{source.publishedAgo}</span>
              <span aria-hidden>/</span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="tracking-[0.2em] text-accent">
                  {"●".repeat(SIGNAL_DOTS[source.signal])}
                  <span className="opacity-25">{"●".repeat(3 - SIGNAL_DOTS[source.signal])}</span>
                </span>
                {source.signal} signal
              </span>
              {isDemo && (
                <>
                  <span aria-hidden>/</span>
                  <span className="text-demo">Demo source · not a real link</span>
                </>
              )}
            </p>
            <p className="font-serif text-[17px] leading-snug text-ink-soft">{source.note}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
