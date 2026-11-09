import type { ReactNode } from "react";
import { DemoStamp } from "./DemoStamp";

/** Tall, phone-proportioned card with a broadcast "slate" bar on top. */
export function StoryCard({
  slateLeft,
  slateRight,
  showDemoStamp = false,
  dashed = false,
  children,
}: {
  slateLeft: ReactNode;
  slateRight?: ReactNode;
  showDemoStamp?: boolean;
  dashed?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden bg-surface ${
        dashed
          ? "border-2 border-dashed border-line"
          : "shadow-[0_30px_60px_-30px_rgba(0,0,0,0.35)] ring-1 ring-line"
      }`}
    >
      <div
        className={`readout flex items-center justify-between gap-3 px-5 py-2.5 pr-24 ${
          dashed ? "text-ink-soft" : "bg-night text-night-ink"
        }`}
      >
        <span className="flex items-center gap-2">{slateLeft}</span>
        {slateRight && <span className="text-right opacity-70">{slateRight}</span>}
      </div>
      {showDemoStamp && <DemoStamp />}
      <div className="flex flex-col gap-8 p-5 sm:p-7">{children}</div>
    </div>
  );
}
