import type { EvidenceSource } from "@/lib/types";

/**
 * Supporting sources, numbered like footnotes.
 * Demo sources are shown as plain text, never as clickable links.
 */
export function EvidenceList({ sources, isDemo }: { sources: EvidenceSource[]; isDemo: boolean }) {
  return (
    <ol className="flex flex-col gap-4">
      {sources.map((source, index) => (
        <li key={source.id} className="flex gap-3 text-sm">
          <span className="font-mono text-neutral-400">{index + 1}.</span>
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {isDemo ? (
                source.title
              ) : (
                <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                  {source.title}
                </a>
              )}
            </p>
            <p className="text-neutral-500 dark:text-neutral-400">
              {source.outlet} · {source.publishedAgo} · {source.signal} signal
              {isDemo && " · demo source, not a real link"}
            </p>
            <p className="text-neutral-600 dark:text-neutral-300">{source.note}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
