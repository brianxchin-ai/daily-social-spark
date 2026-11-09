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
          <h2 className="headline text-[42px] text-balance sm:text-[56px]">{spark.headline}</h2>
          <p className="text-[16px] leading-relaxed">{spark.whyItWillSpread}</p>
          <p className="readout text-ink-soft">For: {spark.brand}</p>
        </header>

        <Verdict spark={spark} />

        <Section index={1} title="48-hour forecast" isDemo={spark.isDemo}>
          <div className="-mx-1">
            <TimeRibbon mode="done" momentum={spark.window} />
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

/**
 * The call in one glance — act window, confidence, momentum — like the
 * single-line summary at the top of a creative brief.
 */
function Verdict({ spark }: { spark: Spark }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="readout font-bold">The call</p>
        <DemoBadge show={spark.isDemo} />
      </div>
      <dl className={`grid grid-cols-2 border-2 border-ink ${spark.isDemo ? "demo-outline" : ""}`}>
        <div className="flex min-w-0 flex-col gap-1 bg-ember px-4 py-3 text-night">
          <dt className="readout font-bold">Act within</dt>
          <dd className="headline text-[40px] sm:text-[52px]">~{spark.window.peakInHours}h</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-l-2 border-ink px-4 py-3">
          <dt className="readout text-ink-soft">Confidence</dt>
          <dd className="headline text-[40px] sm:text-[52px]">
            {spark.confidence}
            <span className="text-[0.55em] text-ink-soft">%</span>
          </dd>
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t-2 border-ink bg-night px-4 py-2 text-night-ink">
          <dt className="sr-only">Momentum</dt>
          <dd className="headline text-[20px]">
            <span className="text-ember">▲</span> {STAGE_LABEL[spark.window.stage]}
          </dd>
          <dd className="readout opacity-70">Window closes ~{spark.window.closesInHours}h</dd>
        </div>
      </dl>
    </div>
  );
}
