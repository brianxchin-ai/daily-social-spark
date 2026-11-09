import { PLATFORMS, type Spark } from "@/lib/types";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { DemoBadge } from "./DemoBadge";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { MetricsRow } from "./MetricsRow";
import { MomentumWindow } from "./MomentumWindow";
import { RiskNotes } from "./RiskNotes";
import { Section } from "./Section";

/** The full result for one scan. */
export function SparkResult({ spark }: { spark: Spark }) {
  const platformLabel = PLATFORMS.find((p) => p.id === spark.platform)?.label ?? spark.platform;
  const generated = new Date(spark.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="flex flex-col gap-6 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <DemoBadge show={spark.isDemo} />
          <span>
            {platformLabel} · {spark.brand} · generated {generated}
          </span>
        </div>
        <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          Trend: {spark.trendName}
        </p>
        <h2 className="text-2xl font-semibold leading-tight">{spark.headline}</h2>
        <p className="text-neutral-700 dark:text-neutral-300">{spark.whyItWillSpread}</p>
      </header>

      <Section title="Why now" isDemo={spark.isDemo}>
        <p className="text-sm">{spark.whyNow}</p>
        <MomentumWindow momentum={spark.window} />
      </Section>

      <Section title="Confidence" isDemo={spark.isDemo}>
        <ConfidenceMeter score={spark.confidence} rationale={spark.confidenceRationale} />
      </Section>

      <Section title="Signals" isDemo={spark.isDemo}>
        <MetricsRow metrics={spark.metrics} />
      </Section>

      <Section title="Evidence" isDemo={spark.isDemo}>
        <EvidenceList sources={spark.evidence} isDemo={spark.isDemo} />
      </Section>

      <Section title="Format ideas" isDemo={spark.isDemo}>
        <FormatIdeas ideas={spark.formatIdeas} />
      </Section>

      <Section title="Risks & watch-outs" isDemo={spark.isDemo}>
        <RiskNotes risks={spark.risks} />
      </Section>
    </article>
  );
}
