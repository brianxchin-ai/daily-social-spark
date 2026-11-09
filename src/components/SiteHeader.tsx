import { TodayLabel } from "./TodayLabel";

/** Broadcast-style top bar: wordmark, live indicator, clock. */
export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <span className="headline flex items-center gap-2 text-[22px]">
          <span aria-hidden className="text-ember">✶</span>
          Daily Social Spark
        </span>
        <span className="readout flex items-center gap-3 text-ink-soft">
          <span className="hidden items-center gap-2 sm:flex">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ember motion-reduce:animate-none" aria-hidden />
            Radar on
          </span>
          <TodayLabel />
        </span>
      </div>
    </header>
  );
}
