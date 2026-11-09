/** Confidence score (0–100) as a simple bar with its rationale. */
export function ConfidenceMeter({ score, rationale }: { score: number; rationale: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{clamped}</span>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">/ 100</span>
      </div>
      <div
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
      >
        <div className="h-full bg-neutral-900 dark:bg-white" style={{ width: `${clamped}%` }} />
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{rationale}</p>
    </div>
  );
}
