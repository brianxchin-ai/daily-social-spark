import type { Metric } from "@/lib/types";

/** Headline numbers backing the opportunity, separated by vertical rules. */
export function MetricsRow({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid gap-6 sm:grid-cols-3 sm:gap-0">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`flex flex-col gap-1 ${index > 0 ? "sm:border-l sm:border-rule sm:pl-6" : ""} sm:pr-6`}
        >
          <dt className="font-serif text-[17px] text-ink-soft">{metric.label}</dt>
          <dd className="text-[36px] leading-tight font-bold tracking-[-0.02em]">{metric.value}</dd>
          {metric.context && <dd className="eyebrow text-[10px] text-demo">{metric.context}</dd>}
        </div>
      ))}
    </dl>
  );
}
