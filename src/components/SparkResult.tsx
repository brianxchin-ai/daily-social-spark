import { PLATFORMS, type DemoSpark, type HypothesisSpark, type Spark } from "@/lib/types";
import { ConfidenceBlocks } from "./ConfidenceBlocks";
import { OriginBadge } from "./DemoBadge";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { Section } from "./Section";
import { SignalsToVerify } from "./SignalsToVerify";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

const STAGE_LABEL: Record<string, string> = {
  rising: "Rising",
  accelerating: "Accelerating",
  "near-peak": "Near peak",
  unclear: "Unclear",
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
        stamp={spark.origin}
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
            <OriginBadge origin={spark.origin} />
          </div>
          <h2
            className={`headline text-balance ${
              spark.headline.length > 90 ? "text-[30px] sm:text-[38px]" : "text-[42px] sm:text-[56px]"
            }`}
          >
            {spark.headline}
          </h2>
          {spark.origin === "ai-hypothesis" && (
            <p className="text-[18px] leading-relaxed font-medium">{spark.concept}</p>
          )}
          <p className="text-[16px] leading-relaxed">{spark.whyItWillSpread}</p>
          <p className="readout text-ink-soft">For: {spark.brand}</p>
        </header>

        {spark.origin === "demo" ? <DemoSections spark={spark} /> : <HypothesisSections spark={spark} />}
      </StoryCard>
    </article>
  );
}

/** Demo layout: unchanged from the UI shell, invented hours, metrics and sources. */
function DemoSections({ spark }: { spark: DemoSpark }) {
  const origin = spark.origin;
  return (
    <>
      <DemoVerdict spark={spark} />

      <Section index={1} title="48-hour forecast" origin={origin}>
        <div className="-mx-1">
          <TimeRibbon mode="done" momentum={spark.window} />
        </div>
      </Section>

      <Section index={2} title="Confidence" origin={origin}>
        <div className="demo-outline">
          <ConfidenceBlocks score={spark.confidence} rationale={spark.confidenceRationale} />
        </div>
      </Section>

      <Section index={3} title="Why now" origin={origin}>
        <WhyNow text={spark.whyNow} />
      </Section>

      <Section index={4} title="Storyboard · format ideas" origin={origin}>
        <FormatIdeas ideas={spark.formatIdeas} />
      </Section>

      <Section index={5} title="Signals" origin={origin}>
        <MetricsRow metrics={spark.metrics} />
      </Section>

      <Section index={6} title="Source log" origin={origin}>
        <EvidenceList sources={spark.evidence} isDemo />
      </Section>

      <Section index={7} title="Watch-outs" origin={origin}>
        <RiskNotes risks={spark.risks} />
      </Section>
    </>
  );
}

/** AI hypothesis layout: timing as a stage plus reasoning, signals to verify, no invented numbers. */
function HypothesisSections({ spark }: { spark: HypothesisSpark }) {
  const origin = spark.origin;
  const { generation } = spark;
  return (
    <>
      <HypothesisVerdict spark={spark} />

      <Section index={1} title="Timing hypothesis · unverified" origin={origin}>
        <div className="flex flex-col gap-4">
          <p className="text-[16px] leading-relaxed">{spark.timing.reasoning}</p>
          <div className="flex flex-col gap-1.5 border-l-4 border-hypo pl-4">
            <p className="readout font-bold text-hypo">What would confirm it</p>
            <p className="text-[15px] leading-relaxed">{spark.timing.whatWouldConfirm}</p>
          </div>
        </div>
      </Section>

      <Section index={2} title="Confidence" origin={origin}>
        <ConfidenceBlocks score={spark.confidence} rationale={spark.confidenceRationale} />
      </Section>

      <Section index={3} title="Why now" origin={origin}>
        <WhyNow text={spark.whyNow} />
      </Section>

      <Section index={4} title="Storyboard · format ideas" origin={origin}>
        <FormatIdeas ideas={spark.formatIdeas} />
      </Section>

      <Section index={5} title="Signals to verify" origin={origin}>
        <SignalsToVerify signals={spark.signalsToVerify} />
      </Section>

      <Section index={6} title="Watch-outs" origin={origin}>
        <RiskNotes risks={spark.risks} />
      </Section>

      <p className="readout border-t border-line pt-4 text-ink-soft">
        Generated by {generation.model} · {generation.inputTokens.toLocaleString()} in /{" "}
        {generation.outputTokens.toLocaleString()} out tokens · ≈${generation.estimatedCostUsd.toFixed(3)} ·
        Unverified hypothesis
      </p>
    </>
  );
}

function WhyNow({ text }: { text: string }) {
  return <p className="border-l-4 border-ember pl-4 text-[17px] leading-relaxed font-medium">{text}</p>;
}

/**
 * The call in one glance—act window, confidence, momentum—like the
 * single-line summary at the top of a creative brief.
 */
function DemoVerdict({ spark }: { spark: DemoSpark }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="readout font-bold">The call</p>
        <OriginBadge origin={spark.origin} />
      </div>
      <dl className="demo-outline grid grid-cols-2 border-2 border-ink">
        <div className="flex min-w-0 flex-col gap-1 bg-ember px-4 py-3 text-night">
          <dt className="readout font-bold">Act within</dt>
          <dd className="headline text-[40px] sm:text-[52px]">~{spark.window.peakInHours}h</dd>
        </div>
        <ConfidenceCell confidence={spark.confidence} />
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

/** Same strip for a hypothesis, without hour predictions. */
function HypothesisVerdict({ spark }: { spark: HypothesisSpark }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="readout font-bold">The call</p>
        <OriginBadge origin={spark.origin} />
      </div>
      <dl className="grid grid-cols-2 border-2 border-ink">
        <div className="col-span-2 flex min-w-0 flex-col gap-1 bg-hypo-soft px-4 py-3 sm:col-span-1">
          <dt className="readout font-bold text-hypo">Stage (hypothesis)</dt>
          <dd className="headline text-[40px] sm:text-[44px]">{STAGE_LABEL[spark.timing.stage]}</dd>
        </div>
        <ConfidenceCell
          confidence={spark.confidence}
          className="col-span-2 border-t-2 sm:col-span-1 sm:border-t-0 sm:border-l-2"
        />
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t-2 border-ink bg-night px-4 py-2 text-night-ink">
          <dt className="sr-only">Timing</dt>
          <dd className="readout font-bold">◇ Timing not verified</dd>
          <dd className="readout opacity-70">Check the signals below before acting</dd>
        </div>
      </dl>
    </div>
  );
}

function ConfidenceCell({ confidence, className = "border-l-2" }: { confidence: number; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 border-ink px-4 py-3 ${className}`}>
      <dt className="readout text-ink-soft">Confidence</dt>
      <dd className="headline text-[40px] sm:text-[52px]">
        {confidence}
        <span className="text-[0.55em] text-ink-soft">%</span>
      </dd>
    </div>
  );
}
