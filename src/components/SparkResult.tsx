import { formatScore } from "@/lib/evaluation/scoring";
import {
  PLATFORMS,
  type Candidate,
  type CandidateEvaluation,
  type DemoSpark,
  type HypothesisSpark,
  type Spark,
  type SparkOrigin,
} from "@/lib/types";
import { ConfidenceBlocks } from "./ConfidenceBlocks";
import { OriginBadge } from "./DemoBadge";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { RefinementPanel } from "./RefinementPanel";
import { Scoreboard } from "./Scoreboard";
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

const AUDIO_LABEL: Record<Candidate["audioRole"], string> = {
  "audio-led": "Audio-led",
  "audio-optional": "Audio optional",
  "no-audio": "No audio needed",
};

/** The full result for one scan, presented as a single story card. */
export function SparkResult({ spark }: { spark: Spark }) {
  const platformLabel = PLATFORMS.find((p) => p.id === spark.platform)?.label ?? spark.platform;
  const generated = new Date(spark.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const finalCandidate = spark.origin === "ai-hypothesis" ? spark.finalCandidate : null;

  return (
    <article className="animate-rise motion-reduce:animate-none">
      <StoryCard
        stamp={spark.origin}
        slateLeft={
          <>
            <span className="h-2 w-2 rounded-full bg-ember" aria-hidden />
            {spark.origin === "ai-hypothesis" && !finalCandidate ? "No spark today" : "Today's spark"}
          </>
        }
        slateRight={`${platformLabel} / ${generated}`}
      >
        {spark.origin === "demo" ? (
          <>
            <Header origin="demo" brand={spark.brand} content={spark} />
            <DemoSections spark={spark} />
          </>
        ) : finalCandidate ? (
          <>
            <Header
              origin="ai-hypothesis"
              brand={spark.brand}
              content={finalCandidate}
              revised={spark.refinement.status === "complete" && spark.refinement.decision.outcome === "kept-revised"}
              refinementFailed={spark.refinement.status === "failed"}
            />
            <HypothesisSections spark={spark} final={finalCandidate} />
          </>
        ) : (
          <NoLeader spark={spark} />
        )}
      </StoryCard>
    </article>
  );
}

function Header({
  origin,
  brand,
  content,
  revised = false,
  refinementFailed = false,
}: {
  origin: SparkOrigin;
  brand: string;
  content: { trendName: string; headline: string; whyItWillSpread: string; concept?: string };
  revised?: boolean;
  refinementFailed?: boolean;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="readout text-ember">Trend ▸ {content.trendName}</p>
        <OriginBadge origin={origin} />
        {revised && (
          <span className="readout rounded-sm bg-ink px-1.5 py-px text-[10px] font-bold text-surface">↻ Revised</span>
        )}
      </div>
      {refinementFailed && (
        <p className="readout text-ink-soft">⚠ Refinement could not be completed—showing the evaluated leader, unrevised.</p>
      )}
      <h2
        className={`headline text-balance ${
          content.headline.length > 90 ? "text-[30px] sm:text-[38px]" : "text-[42px] sm:text-[56px]"
        }`}
      >
        {content.headline}
      </h2>
      {content.concept && <p className="text-[18px] leading-relaxed font-medium">{content.concept}</p>}
      <p className="text-[16px] leading-relaxed">{content.whyItWillSpread}</p>
      <p className="readout text-ink-soft">For: {brand}</p>
    </header>
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

/** AI hypothesis layout: the final version, the evaluation, and the refinement record. */
function HypothesisSections({ spark, final }: { spark: HypothesisSpark; final: Candidate }) {
  const origin = spark.origin;
  const { refinement } = spark;
  const leaderId = spark.evaluation.leaderId!;
  const original = spark.candidates.find((c) => c.id === leaderId)!;
  const originalEvaluation = spark.evaluation.evaluations.find((e) => e.candidateId === leaderId)!;
  const finalEvaluation =
    refinement.status === "complete" && refinement.decision.outcome === "kept-revised" && refinement.revision?.evaluation
      ? refinement.revision.evaluation
      : originalEvaluation;
  return (
    <>
      <HypothesisVerdict evaluation={finalEvaluation} />

      <Section index={1} title="Timing hypothesis · unverified" origin={origin}>
        <div className="flex flex-col gap-4">
          <p className="text-[16px] leading-relaxed">{final.timing.hypothesis}</p>
          <div className="flex flex-col gap-1.5 border-l-4 border-hypo pl-4">
            <p className="readout font-bold text-hypo">What would confirm or refute it</p>
            <p className="text-[15px] leading-relaxed">{final.timing.whatWouldConfirm}</p>
          </div>
        </div>
      </Section>

      <Section index={2} title="Evaluation · provisional" origin={origin}>
        <Scoreboard report={spark.evaluation} candidates={spark.candidates} />
      </Section>

      <Section index={3} title="Refinement · provisional" origin={origin}>
        <RefinementPanel refinement={refinement} original={original} originalEvaluation={originalEvaluation} />
      </Section>

      <Section index={4} title="Why now" origin={origin}>
        <WhyNow text={final.whyNow} />
      </Section>

      <Section index={5} title="Storyboard · format ideas" origin={origin}>
        <FormatIdeas ideas={final.formatIdeas} />
        <AudioApproach candidate={final} />
      </Section>

      <Section index={6} title="Signals to verify" origin={origin}>
        <SignalsToVerify signals={final.signalsToVerify} />
      </Section>

      <Section index={7} title="Watch-outs" origin={origin}>
        <RiskNotes risks={final.risks} />
      </Section>

      <GenerationFooter spark={spark} />
    </>
  );
}

/** Every candidate was rejected: say so plainly, and show why. Nothing is promoted. */
function NoLeader({ spark }: { spark: HypothesisSpark }) {
  return (
    <>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="readout text-ember">Scan result</p>
          <OriginBadge origin={spark.origin} />
        </div>
        <h2 className="headline text-[42px] text-balance sm:text-[56px]">No candidate cleared the bar</h2>
        <p className="text-[16px] leading-relaxed">
          All three opportunities were rejected on creative merit, so none is recommended. This is a provisional
          creative rejection, not an evidence-based one. Try another scan, or a different brand or platform.
        </p>
        <p className="readout text-ink-soft">For: {spark.brand}</p>
      </header>
      <Section index={1} title="Evaluation · provisional" origin={spark.origin}>
        <Scoreboard report={spark.evaluation} candidates={spark.candidates} />
      </Section>
      <GenerationFooter spark={spark} />
    </>
  );
}

function AudioApproach({ candidate }: { candidate: Candidate }) {
  return (
    <div className="flex flex-col gap-1.5 border-l-4 border-line pl-4">
      <p className="readout font-bold">Audio approach · {AUDIO_LABEL[candidate.audioRole]}</p>
      {candidate.audioVariations.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[14px] leading-relaxed">
          {candidate.audioVariations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GenerationFooter({ spark }: { spark: HypothesisSpark }) {
  const { generation } = spark;
  return (
    <p className="readout border-t border-line pt-4 text-ink-soft">
      {generation.calls.length} calls to {generation.model} ({generation.calls.map((c) => c.step).join(" + ")}) ·{" "}
      {generation.inputTokens.toLocaleString()} in / {generation.outputTokens.toLocaleString()} out tokens · ≈$
      {generation.estimatedCostUsd.toFixed(3)} · Unverified hypotheses
    </p>
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

/** Same strip for a hypothesis: momentum stays Unverified; the Concept Score is provisional. */
function HypothesisVerdict({ evaluation }: { evaluation: CandidateEvaluation }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="readout font-bold">The call</p>
        <OriginBadge origin="ai-hypothesis" />
      </div>
      <dl className="grid grid-cols-2 border-2 border-ink">
        <div className="col-span-2 flex min-w-0 flex-col gap-1 bg-hypo-soft px-4 py-3 sm:col-span-1">
          <dt className="readout font-bold text-hypo">Momentum</dt>
          <dd className="headline text-[40px] sm:text-[44px]">Unverified</dd>
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-1 border-t-2 border-ink px-4 py-3 sm:col-span-1 sm:border-t-0 sm:border-l-2">
          <dt className="readout text-ink-soft">Concept Score · provisional</dt>
          <dd className="headline text-[40px] sm:text-[52px]">
            {formatScore(evaluation.score.conceptScore)}
            <span className="text-[0.55em] text-ink-soft">/100</span>
          </dd>
        </div>
        <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t-2 border-ink bg-night px-4 py-2 text-night-ink">
          <dt className="sr-only">Evidence status</dt>
          <dd className="readout font-bold">◇ Creative merit only</dd>
          <dd className="readout opacity-70">Cultural relevance and momentum unverified</dd>
        </div>
      </dl>
    </div>
  );
}
