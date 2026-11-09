import { PLATFORMS, type Spark } from "@/lib/types";
import { DemoBadge } from "./DemoBadge";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { KeyStats } from "./KeyStats";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { Section } from "./Section";

/** The full result for one scan, laid out like an editorial feature. */
export function SparkResult({ spark }: { spark: Spark }) {
  const platformLabel = PLATFORMS.find((p) => p.id === spark.platform)?.label ?? spark.platform;
  const generated = new Date(spark.generatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="flex animate-rise flex-col gap-12 motion-reduce:animate-none">
      <header className="grid gap-6 border-t border-ink pt-6 md:grid-cols-[200px_1fr] md:gap-12">
        <div className="flex items-start gap-2 md:flex-col">
          <p className="eyebrow">02 — Today&apos;s spark</p>
          <DemoBadge show={spark.isDemo} />
        </div>
        <div className="flex flex-col gap-5">
          <p className="eyebrow text-accent">
            {platformLabel} / {spark.brand} / {generated}
          </p>
          <p className="eyebrow text-ink-soft">Trend · {spark.trendName}</p>
          <h2 className="text-[34px] leading-[1.05] font-bold tracking-[-0.025em] text-balance sm:text-[48px]">
            {spark.headline}
          </h2>
          <p className="max-w-2xl font-serif text-[22px] leading-snug">{spark.whyItWillSpread}</p>
        </div>
      </header>

      <KeyStats
        confidence={spark.confidence}
        rationale={spark.confidenceRationale}
        momentum={spark.window}
        isDemo={spark.isDemo}
      />

      <Section title="Why now" isDemo={spark.isDemo}>
        <p className="max-w-2xl font-serif text-[22px] leading-snug">{spark.whyNow}</p>
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
