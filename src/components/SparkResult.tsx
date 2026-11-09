import { PLATFORMS, type Spark } from "@/lib/types";
import { ConfidenceBlocks } from "./ConfidenceBlocks";
import { DemoBadge } from "./DemoBadge";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { Section } from "./Section";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

const STAGE_LABEL: Record<Spark["window"]["stage"], string> = {
  rising: "Rising",
  accelerating: "Accelerating",
  "near-peak": "Near peak",
};

/** The full result for one scan, presented as a single story card. */
export function SparkResult({ spark }: { spark: Spark }) {
  const platformLabel = PLATFORMS.find((p) => p.id === spark.platform)?.label ?? spark.platform;
  const generated = new Date(spark.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <article className="animate-rise motion-reduce:animate-none">
      <StoryCard
        showDemoStamp={spark.isDemo}
        slateLeft={
          <>
            <span className="h-2 w-2 rounded-full bg-ember" aria-hidden />
            Today&apos;s spark
          </>
        }
        slateRight={`${platformLabel} / ${generated}`}
      >
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="readout text-ember">Trend ▸ {spark.trendName}</p>
            <DemoBadge show={spark.isDemo} />
          </div>
          <h2 className="headline text-[40px] text-balance sm:text-[50px]">{spark.headline}</h2>
          <p className="text-[16px] leading-relaxed">{spark.whyItWillSpread}</p>
          <p className="readout text-ink-soft">For: {spark.brand}</p>
        </header>

        <Section index={1} title="48-hour forecast" isDemo={spark.isDemo}>
          <div className="-mx-1">
            <TimeRibbon mode="done" momentum={spark.window} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="readout rounded-full bg-ember px-3 py-1 font-bold text-night">
              ▲ {STAGE_LABEL[spark.window.stage]}
            </span>
            <span className="readout rounded-full border border-line px-3 py-1 text-ink-soft">
              Peak ~{spark.window.peakInHours}h
            </span>
            <span className="readout rounded-full border border-line px-3 py-1 text-ink-soft">
              Closes ~{spark.window.closesInHours}h
            </span>
          </div>
        </Section>

        <Section index={2} title="Confidence" isDemo={spark.isDemo}>
          <div className="demo-outline">
            <ConfidenceBlocks score={spark.confidence} rationale={spark.confidenceRationale} />
          </div>
        </Section>

        <Section index={3} title="Why now" isDemo={spark.isDemo}>
          <p className="border-l-4 border-ember pl-4 text-[17px] leading-relaxed font-medium">
            {spark.whyNow}
          </p>
        </Section>

        <Section index={4} title="Storyboard · format ideas" isDemo={spark.isDemo}>
          <FormatIdeas ideas={spark.formatIdeas} />
        </Section>

        <Section index={5} title="Signals" isDemo={spark.isDemo}>
          <MetricsRow metrics={spark.metrics} />
        </Section>

        <Section index={6} title="Source log" isDemo={spark.isDemo}>
          <EvidenceList sources={spark.evidence} isDemo={spark.isDemo} />
        </Section>

        <Section index={7} title="Watch-outs" isDemo={spark.isDemo}>
          <RiskNotes risks={spark.risks} />
        </Section>
      </StoryCard>
    </article>
  );
}
