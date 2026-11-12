import { formatScore, type EvidenceStatus } from "@/lib/evaluation/scoring";
import type { EvidenceLedger } from "@/lib/research/ledger";
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
import { DecisionTrace } from "./DecisionTrace";
import { OriginBadge } from "./DemoBadge";
import { EvidencePanel } from "./EvidencePanel";
import { plural, researchSummary, StatusBadge, statusHelp } from "./EvidenceStatus";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeas } from "./FormatIdeas";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { RefinementPanel } from "./RefinementPanel";
import { computeTies, Scoreboard, tieShort } from "./Scoreboard";
import { Section } from "./Section";
import { SignalsToVerify } from "./SignalsToVerify";
import { StoryCard } from "./StoryCard";
import { StrategyPanel } from "./StrategyPanel";
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
              refinementSkipped={spark.refinement.status === "skipped"}
              status={finalEvaluationOf(spark).score.status}
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
  refinementSkipped = false,
  status,
}: {
  origin: SparkOrigin;
  brand: string;
  content: { trendName: string; headline: string; whyItWillSpread: string; concept?: string };
  revised?: boolean;
  refinementFailed?: boolean;
  refinementSkipped?: boolean;
  status?: EvidenceStatus;
}) {
  return (
    <header className="flex flex-col gap-4">
      {/* Right padding keeps the label row clear of the corner sash on narrow screens. */}
      <div className="flex flex-wrap items-center gap-2 pr-20">
        <p className="readout text-ember">Trend ▸ {content.trendName}</p>
        <OriginBadge origin={origin} />
        {status && <StatusBadge status={status} />}
        {revised && (
          <span className="readout rounded-sm bg-ink px-1.5 py-px text-[10px] font-bold text-surface">↻ Revised</span>
        )}
      </div>
      {refinementFailed && (
        <p className="readout text-ink-soft">⚠ Refinement could not be completed—showing the evaluated leader, unrevised.</p>
      )}
      {refinementSkipped && (
        <p className="readout text-ink-soft">⚠ Refinement was skipped to stay within the time budget—showing the evaluated leader, unrevised.</p>
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

/** The evaluation behind the version presented: the revision's if it won, otherwise the leader's. */
function finalEvaluationOf(spark: HypothesisSpark): CandidateEvaluation {
  const { refinement } = spark;
  const leaderEvaluation = spark.evaluation.evaluations.find((e) => e.candidateId === spark.evaluation.leaderId)!;
  return refinement.status === "complete" && refinement.decision.outcome === "kept-revised" && refinement.revision?.evaluation
    ? refinement.revision.evaluation
    : leaderEvaluation;
}

/**
 * AI result layout. The winning idea stays the hero; strategy, evaluation,
 * alternatives, evidence and the decision trace follow, with detail behind
 * progressive disclosure.
 */
function HypothesisSections({ spark, final }: { spark: HypothesisSpark; final: Candidate }) {
  const origin = spark.origin;
  const { refinement } = spark;
  const leaderId = spark.evaluation.leaderId!;
  const original = spark.candidates.find((c) => c.id === leaderId)!;
  const originalEvaluation = spark.evaluation.evaluations.find((e) => e.candidateId === leaderId)!;
  const finalEvaluation = finalEvaluationOf(spark);
  const ledger = spark.research.status === "verified" ? spark.research.ledger : null;
  const platformLabel = PLATFORMS.find((p) => p.id === spark.platform)?.label ?? spark.platform;
  const momentum = finalEvaluation.results.find((r) => r.criterionId === "emergingMomentum")!;
  const revisedFrom = finalEvaluation.candidateId !== leaderId ? leaderId : null;
  return (
    <>
      <HypothesisVerdict spark={spark} evaluation={finalEvaluation} />

      <Section index={1} title="Why this idea" origin={origin}>
        <StrategyPanel
          candidate={final}
          evaluation={finalEvaluation}
          ledger={ledger}
          brand={spark.brand}
          platformLabel={platformLabel}
        />
      </Section>

      <Section index={2} title="Storyboard · format ideas" origin={origin}>
        <FormatIdeas ideas={final.formatIdeas} />
        <AudioApproach candidate={final} />
      </Section>

      <Section index={3} title="Evaluation" origin={origin}>
        <Scoreboard report={spark.evaluation} candidates={spark.candidates} revisedFrom={revisedFrom ?? undefined} />
      </Section>

      <Section index={4} title="The three ideas · compare" origin={origin}>
        <ThreeIdeas spark={spark} ledger={ledger} platformLabel={platformLabel} />
      </Section>

      <Section index={5} title="Evidence" origin={origin}>
        <EvidencePanel spark={spark} />
      </Section>

      <Section index={6} title={momentum.status === "scored" ? "Timing · momentum evidence verified" : "Timing hypothesis · momentum unverified"} origin={origin}>
        <div className="flex flex-col gap-4">
          <p className="text-[16px] leading-relaxed">{final.timing.hypothesis}</p>
          <div className="flex flex-col gap-1.5 border-l-4 border-hypo pl-4">
            <p className="readout font-bold text-hypo">What would confirm or refute it</p>
            <p className="text-[15px] leading-relaxed">{final.timing.whatWouldConfirm}</p>
          </div>
          <p className="readout text-ink-soft">
            {momentum.status === "scored"
              ? `Momentum ${momentum.score}/5 from a cited, behavior-dated increase. ${momentum.rationale}`
              : `Momentum unverified: ${momentum.rationale}`}
          </p>
        </div>
      </Section>

      <Section index={7} title="Refinement" origin={origin}>
        <RefinementPanel refinement={refinement} original={original} originalEvaluation={originalEvaluation} />
      </Section>

      <Section index={8} title="Why now" origin={origin}>
        <WhyNow text={final.whyNow} />
      </Section>

      <Section index={9} title="Signals to verify" origin={origin}>
        <SignalsToVerify signals={final.signalsToVerify} />
      </Section>

      <Section index={10} title="Watch-outs" origin={origin}>
        <RiskNotes risks={final.risks} />
      </Section>

      <DecisionTrace spark={spark} />
      <GenerationFooter spark={spark} />
    </>
  );
}

/** All three ideas, ranked, each with its full strategy, so alternatives can be inspected. */
function ThreeIdeas({
  spark,
  ledger,
  platformLabel,
}: {
  spark: HypothesisSpark;
  ledger: EvidenceLedger | null;
  platformLabel: string;
}) {
  const ties = computeTies(spark.evaluation);
  const tied = new Set(ties.flatMap((t) => [t.ahead, t.behind]));
  const revised = spark.refinement.status === "complete" && spark.refinement.decision.outcome === "kept-revised";
  return (
    <div className="flex flex-col gap-2">
      {revised && (
        <p className="text-[13px] leading-relaxed text-ink-soft">
          The ideas as first generated and scored. The recommendation at the top is the revised version of the winner.
        </p>
      )}
      {spark.evaluation.evaluations.map((e) => {
        const c = spark.candidates.find((x) => x.id === e.candidateId)!;
        return (
          <details key={c.id} className="group border border-line bg-canvas">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="readout text-ink-soft">
                  {e.score.rank ? `#${e.score.rank}` : "Rejected"}
                  {tied.has(c.id) ? " · tied" : ""}
                  {c.id === spark.evaluation.leaderId ? (revised ? " · original winner, revised above" : " · leader") : ""} ·{" "}
                  {c.territory}
                </span>
                <span className="text-[15px] leading-snug font-semibold">{c.headline}</span>
                <StatusBadge status={e.score.status} />
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="headline text-[22px]">{formatScore(e.score.rankingScore)}</span>
                <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">▸</span>
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-line p-3">
              <p className="text-[15px] leading-relaxed">{c.concept}</p>
              <StrategyPanel candidate={c} evaluation={e} ledger={ledger} brand={spark.brand} platformLabel={platformLabel} />
            </div>
          </details>
        );
      })}
    </div>
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
          All three opportunities were rejected by our rules, so none is recommended. The reasons are in the
          evaluation below. Try another scan, or a different brand or platform.
        </p>
        <p className="readout text-ink-soft">For: {spark.brand}</p>
      </header>
      <Section index={1} title="Evaluation" origin={spark.origin}>
        <Scoreboard report={spark.evaluation} candidates={spark.candidates} />
      </Section>
      <Section index={2} title="Evidence" origin={spark.origin}>
        <EvidencePanel spark={spark} />
      </Section>
      <DecisionTrace spark={spark} />
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
  const research = spark.research.status === "verified" ? spark.research.ledger.researchUsage : undefined;
  const calls = generation.calls.length + (research?.calls.length ?? 0);
  const cost = generation.estimatedCostUsd + (research?.estimatedCostUsd ?? 0);
  return (
    <p className="readout border-t border-line pt-4 text-ink-soft">
      {calls} calls to {generation.model}
      {research ? ` (research ${research.calls.length} + creative ${generation.calls.length})` : ` (${generation.calls.map((c) => c.step).join(" + ")})`}
      {research ? ` · ${plural(research.webSearches, "web search", "web searches")}` : ""} · creative {generation.inputTokens.toLocaleString()} in /{" "}
      {generation.outputTokens.toLocaleString()} out tokens · ≈${cost.toFixed(3)} estimated
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

/**
 * The call for an AI result: how well evidenced it is, the score that ranked
 * it (marked provisional when it rests on placeholders), its Concept Score,
 * what research informed it, and whether it won on a tie.
 */
function HypothesisVerdict({ spark, evaluation }: { spark: HypothesisSpark; evaluation: CandidateEvaluation }) {
  const { score } = evaluation;
  const research = researchSummary(spark.research);
  const name = (id: string) => spark.candidates.find((c) => c.id === id)?.trendName ?? id;
  const leaderTie = computeTies(spark.evaluation).find((t) => t.ahead === spark.evaluation.leaderId);
  const leaderScore = spark.evaluation.evaluations.find((e) => e.candidateId === spark.evaluation.leaderId)!.score;
  return (
    <div className="flex flex-col gap-2">
      <p className="readout font-bold">The call</p>
      <dl className="grid grid-cols-2 border-2 border-ink">
        <div className="col-span-2 flex min-w-0 flex-col gap-1 bg-hypo-soft px-4 py-3">
          <dt className="readout font-bold text-hypo">Evidence</dt>
          <dd className="headline text-[30px] sm:text-[36px]">
            {score.status === "evidence-backed" ? "Evidence-backed" : score.status === "partially-evidenced" ? "Partially evidenced" : "Unverified hypothesis"}
          </dd>
          <dd className="text-[13px] leading-snug">{statusHelp(score.status)}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t-2 border-ink px-4 py-3">
          <dt className="readout text-ink-soft">{score.provisional ? "Provisional Ranking Score" : "Ranking Score"}</dt>
          <dd className="headline text-[40px] sm:text-[48px]">
            {formatScore(score.rankingScore)}
            <span className="text-[0.55em] text-ink-soft">/100</span>
          </dd>
          {score.provisional && (
            <dd className="readout text-[10px] text-hypo">{score.placeholders.length} criteria assumed ◇ 3</dd>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t-2 border-l-2 border-ink px-4 py-3">
          <dt className="readout text-ink-soft">Concept Score</dt>
          <dd className="headline text-[40px] sm:text-[48px]">
            {formatScore(score.conceptScore)}
            <span className="text-[0.55em] text-ink-soft">/100</span>
          </dd>
          <dd className="readout text-[10px] text-ink-soft">5 creative criteria</dd>
        </div>
        <div className="col-span-2 flex flex-col gap-1 border-t-2 border-ink bg-night px-4 py-2 text-night-ink">
          <dt className="sr-only">Research</dt>
          <dd className="readout">
            {research.tone === "ok" ? "◇ " : "⚠ "}
            {research.text}
          </dd>
          {evaluation.candidateId !== spark.evaluation.leaderId && (
            <dd className="readout">
              ↻ Revised version of the original winner: ranking {formatScore(leaderScore.rankingScore)} →{" "}
              {formatScore(score.rankingScore)}, concept {formatScore(leaderScore.conceptScore)} →{" "}
              {formatScore(score.conceptScore)}. The comparison below shows the original.
            </dd>
          )}
          {leaderTie && (
            <dd className="readout font-bold text-ember">
              = {evaluation.candidateId !== spark.evaluation.leaderId ? "Before revision: " : ""}
              {tieShort(leaderTie, name)}
            </dd>
          )}
        </div>
      </dl>
    </div>
  );
}
