/** Confidence as ten blocks, like a signal-strength meter. */
export function ConfidenceBlocks({ score, rationale }: { score: number; rationale: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  const lit = Math.round(clamped / 10);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-4">
        <p className="font-mono text-[44px] leading-none font-bold tabular-nums">
          {clamped}
          <span className="text-[20px] text-ink-soft">%</span>
        </p>
        <div
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          className="flex h-8 flex-1 items-end gap-1"
        >
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={`flex-1 ${i < lit ? "bg-ember" : "bg-line"}`}
              style={{ height: `${40 + i * 6}%` }}
            />
          ))}
        </div>
      </div>
      <p className="text-[14px] leading-relaxed text-ink-soft">{rationale}</p>
    </div>
  );
}
