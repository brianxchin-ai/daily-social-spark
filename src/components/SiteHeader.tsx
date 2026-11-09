import { TodayLabel } from "./TodayLabel";

/** Top bar: wordmark left, dateline right, hairline beneath. */
export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em]">
          Daily Social Spark
        </span>
        <span className="eyebrow text-ink-soft">
          <TodayLabel />
        </span>
      </div>
    </header>
  );
}
