import type { Metric } from "@/lib/types";

/** Headline numbers as monospaced readouts. */
export function MetricsRow({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="demo-outline grid grid-cols-1 divide-y divide-line bg-canvas sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {metrics.map((metric) => (
        <div key={metric.label} className="flex flex-col gap-1 p-3">
          <dt className="readout text-[10px] text-ink-soft">{metric.label}</dt>
          <dd className="font-mono text-[26px] leading-tight font-bold tabular-nums">{metric.value}</dd>
          {metric.context && <dd className="readout text-[10px] text-demo">{metric.context}</dd>}
        </div>
      ))}
    </dl>
  );
}
