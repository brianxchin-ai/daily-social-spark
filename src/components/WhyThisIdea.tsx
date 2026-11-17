import type { EvidenceStatus } from "@/lib/evaluation/scoring";
import type { IdeaSource } from "@/lib/research/idea-sources";
import { plural } from "./EvidenceStatus";

const TREND_NOTE: Record<EvidenceStatus, string> = {
  "evidence-backed": "the trend is confirmed by dated sources",
  "partially-evidenced": "the trend is only partly confirmed",
  "unverified-hypothesis": "none confirm the trend is growing yet",
};

/** The search API's page age is free text ("0 days ago", "1 days ago"); tidy the awkward cases. */
export function tidyAge(age: string): string {
  return age
    .replace(/^0 (days|hours) ago$/i, "today")
    .replace(/^1 days ago$/i, "1 day ago")
    .replace(/^1 hours ago$/i, "1 hour ago");
}

/**
 * Why this idea, in a short paragraph, then the links behind it. Links come
 * only from the research ledger (see sourcesForIdea), never from the AI.
 */
export function WhyThisIdea({
  paragraphs,
  sources,
  status,
  researched,
}: {
  paragraphs: string[];
  sources: IdeaSource[];
  status: EvidenceStatus;
  /** Did verified research run for this scan? */
  researched: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      {paragraphs.map((p, i) => (
        <p key={i} className="max-w-[64ch] text-[16px] leading-[1.65]">
          {p}
        </p>
      ))}

      <p className="readout text-hypo">
        ◇{" "}
        {!researched
          ? "No live research was used · treat this as a creative hypothesis"
          : sources.length === 0
            ? "No sources support this idea directly · treat it as a creative hypothesis"
            : `${plural(sources.length, "source")} · ${TREND_NOTE[status]}`}
      </p>

      {sources.length > 0 && (
        <ul className="border-t border-line">
          {sources.map((s) => (
            <li key={s.id} className="border-b border-line">
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group grid grid-cols-[76px_minmax(0,1fr)_auto] items-baseline gap-3 px-0.5 py-2.5"
              >
                <span
                  className={`readout border px-1 py-px text-center text-[10px] ${
                    s.kind === "social" ? "border-ember text-ember" : "border-line"
                  }`}
                >
                  {s.kind === "social" ? "Social post" : "Article"}
                </span>
                <span className="min-w-0 text-[14px] leading-snug font-semibold break-words group-hover:underline">
                  {/* Social posts often use their whole caption as the title; keep it to three lines. */}
                  <span className="line-clamp-3" title={s.title}>
                    {s.title}
                  </span>
                  <span className="block text-[12.5px] font-normal text-ink-soft">
                    {s.domain}
                    {s.pageUpdated ? ` · page updated ${tidyAge(s.pageUpdated)}` : ""}
                    {s.role === "context" ? " · context only" : ""}
                  </span>
                </span>
                <span aria-hidden className="readout text-ink-soft">↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
