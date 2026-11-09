import type { Metric } from "@/lib/types";

/** Headline numbers backing the opportunity. */
export function MetricsRow({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <dt className="text-xs text-neutral-500 dark:text-neutral-400">{metric.label}</dt>
          <dd className="text-xl font-semibold">{metric.value}</dd>
          {metric.context && (
            <dd className="text-xs text-neutral-500 dark:text-neutral-400">{metric.context}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
