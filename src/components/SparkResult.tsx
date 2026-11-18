import { criterion, formatScore, FRESH_TREND_HEAD_START } from "@/lib/evaluation/scoring";
import { freshestSignal } from "@/lib/evaluation/evidence";
import { sourcesForIdea } from "@/lib/research/idea-sources";
import type { EvidenceLedger } from "@/lib/research/ledger";
import type { ReactNode } from "react";
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
import { AgentTrace } from "./AgentTrace";
import { DecisionTrace } from "./DecisionTrace";
import { OriginBadge } from "./DemoBadge";
import { EvidencePanel } from "./EvidencePanel";
import { plural, RelevanceBadge } from "./EvidenceStatus";
import { EvidenceList } from "./EvidenceList";
import { FormatIdeasCompact } from "./FormatIdeas";
import { LonglistPanel } from "./LonglistPanel";
import { MetricsRow } from "./MetricsRow";
import { RiskNotes } from "./RiskNotes";
import { RefinementPanel } from "./RefinementPanel";
import { computeTies, Scoreboard, tieShort } from "./Scoreboard";
import { Section } from "./Section";
import { SignalsToVerify } from "./SignalsToVerify";
import { SparkScore } from "./SparkScore";
import { StoryCard } from "./StoryCard";
import { StrategyPanel } from "./StrategyPanel";
import { TimeRibbon } from "./TimeRibbon";
import { Walkthrough } from "./Walkthrough";
import { WhyThisIdea } from "./WhyThisIdea";

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
            <Header origin="demo" brand={spark.brand} audience={spark.audience} content={spark} />
            <DemoSections spark={spark} />
          </>
        ) : finalCandidate ? (
          <>
            <Header origin="ai-hypothesis" brand={spark.brand} audience={spark.audience} content={finalCandidate} />
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
  audience,
  content,
}: {
  origin: SparkOrigin;
  brand: string;
  audience?: string;
  content: { trendName: string; headline: string; concept?: string; basis?: "trend" | "original" };
}) {
  const original = content.basis === "original";
  return (
    <header className="flex flex-col gap-4">
      {/* Right padding keeps the label row clear of the corner sash on narrow screens. */}
      <div className="flex flex-wrap items-center gap-2 pr-20">
        <p className="readout text-ember">
          {original ? "Original format" : "Trend"} ▸ {content.trendName}
        </p>
        <OriginBadge origin={origin} />
        {original && (
          <span
            className="readout rounded-sm border border-ink px-1.5 py-px text-[10px] font-bold"
            title="Invented from attention and behavioral principles and timely context, not from a current trend."
          >
            ✦ Not built on a current trend
          </span>
        )}
      </div>
      <h2
        className={`headline text-balance ${
          content.headline.length > 90 ? "text-[30px] sm:text-[38px]" : "text-[42px] sm:text-[56px]"
        }`}
      >
        {content.headline}
      </h2>
      {content.concept && <p className="max-w-[62ch] text-[18px] leading-relaxed font-medium">{content.concept}</p>}
      <p className="readout text-ink-soft">
        For: {brand}
        {audience && <span className="normal-case"> · Audience: {audience}</span>}
      </p>
    </header>
  );
}

/** Everything behind the recommendation, closed by default. */
function Drawer({
  subtitle = "The longlist, timing, risks, the other ideas, evidence detail and the full decision trace",
  children,
}: {
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <details className="group border border-line bg-canvas">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="readout font-bold">How we got here</span>
          <span className="text-[13px] text-ink-soft">{subtitle}</span>
        </span>
        <span aria-hidden className="readout text-ink-soft transition-transform group-open:rotate-90">▸</span>
      </summary>
      <div className="flex flex-col gap-6 border-t border-line px-4 pt-4 pb-5">{children}</div>
    </details>
  );
}

function DrawerPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="readout border-t border-line pt-3 font-bold">{title}</h4>
      {children}
    </section>
  );
}

/** Demo layout: the same five sections, with invented hours, metrics and sources. */
function DemoSections({ spark }: { spark: DemoSpark }) {
  const origin = spark.origin;
  return (
    <>
      <Section index={1} title="Confidence" origin={origin}>
        <div className="demo-outline">
          <ConfidenceBlocks score={spark.confidence} rationale={spark.confidenceRationale} />
        </div>
      </Section>

      <Section index={2} title="How it could play out" origin={origin}>
        <Walkthrough text={spark.walkthrough} />
      </Section>

      <Section index={3} title="Three more ways in" origin={origin}>
        <FormatIdeasCompact ideas={spark.formatIdeas} />
      </Section>

      <Section index={4} title="Why this idea" origin={origin}>
        <div className="flex flex-col gap-3.5">
          <p className="max-w-[64ch] text-[16px] leading-[1.65]">
            {spark.whyItWillSpread} {spark.whyNow}
          </p>
          <EvidenceList sources={spark.evidence} isDemo />
        </div>
      </Section>

      <Drawer subtitle="The 48-hour forecast, signals and watch-outs">
        <DrawerPart title="48-hour forecast">
          <div className="-mx-1">
            <TimeRibbon mode="done" momentum={spark.window} />
          </div>
        </DrawerPart>
        <DrawerPart title="Signals">
          <MetricsRow metrics={spark.metrics} />
        </DrawerPart>
        <DrawerPart title="Watch-outs">
          <RiskNotes risks={spark.risks} />
        </DrawerPart>
      </Drawer>
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
 * Why this idea was picked, from what our code knows: its rank, its two
 * strongest measured criteria, and whether it won on a tie.
 */
const NUMBER_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };

/** Day 6: the same facts, told as the agent's process rather than the fixed workflow's. */
function agentSelectionSentence(spark: HypothesisSpark, evaluation: CandidateEvaluation, strongest: string[]): string {
  const agent = spark.agent!;
  const pool = spark.longlist?.ideas.length ?? 0;
  const developed = spark.longlist?.ideas.filter((i) => i.pick).length ?? spark.candidates.length;
  const reviewed = spark.candidates.length;
  const word = (n: number) => NUMBER_WORDS[n] ?? String(n);
  const noted = pool ? `noted ${pool === 1 ? "one idea" : `${word(pool)} ideas`}, ` : "";
  const parts = [
    `The agent ${noted}developed ${developed === 1 ? "one" : word(developed)} in full and had ${reviewed === 1 ? "this one" : `${word(reviewed)}`} reviewed. The independent review panel ${
      reviewed === 1 ? "scored it" : agent.tieJudgment ? "tied it for the top score" : "scored it highest"
    }${strongest.length ? `, with its strongest marks for ${strongest.join(" and ")}` : ""}.`,
  ];
  if (reviewed === 1) parts.push("No other idea was reviewed against it, so its score is a single read, not a win over contenders.");
  if (agent.tieJudgment) parts.push("The agent broke the tie on creative judgment (see the trace).");
  if (evaluation.candidateId !== spark.evaluation.leaderId) parts.push("The agent then revised it once, and the revision passed every rule our code applies.");
  if (agent.how === "stopped") parts.push("The scan stopped early at a limit, so this is the best idea already scored.");
  return parts.join(" ");
}

function selectionSentence(spark: HypothesisSpark, evaluation: CandidateEvaluation): string {
  const strongest = evaluation.results
    .filter((r) => r.status === "scored" && r.score !== null && criterion(r.criterionId).basis === "concept")
    .sort((a, b) => b.score! - a.score! || criterion(b.criterionId).weight - criterion(a.criterionId).weight)
    .slice(0, 2)
    .map((r) => criterion(r.criterionId).name.toLowerCase());
  if (spark.agent) return agentSelectionSentence(spark, evaluation, strongest);
  const others = spark.candidates.length - 1;
  const name = (id: string) => spark.candidates.find((c) => c.id === id)?.trendName ?? id;
  const tie = computeTies(spark.evaluation).find((t) => t.ahead === spark.evaluation.leaderId);
  const count = NUMBER_WORDS[spark.candidates.length] ?? spark.candidates.length;
  const pool = spark.longlist ? spark.longlist.ideas.length : 0;
  const rivals = spark.evaluation.evaluations.filter((e) => e.candidateId !== spark.evaluation.leaderId);
  const fallback =
    evaluation.score.kind !== "original"
      ? ""
      : rivals.some((e) => e.score.kind === "fresh-trend" && !e.score.rejected)
        ? ` It beat the fresh trend ideas by more than their ${FRESH_TREND_HEAD_START}-point head start.`
        : rivals.some((e) => e.score.kind !== "original")
          ? " No fresh trend idea cleared the bar, so the best original format was recommended."
          : "";
  const parts = [
    pool > 0
      ? `The Generator picked it as one of ${count} ideas, from a longlist of ${NUMBER_WORDS[pool] ?? pool}, for its distribution potential. The independent reviewer then ranked it first${
          strongest.length ? `, with its strongest marks for ${strongest.join(" and ")}` : ""
        }.`
      : `It ranked first of the ${count} ideas this scan generated${
          strongest.length ? `, with its strongest marks for ${strongest.join(" and ")}` : ""
        }.`,
  ];
  if (others > 0 && tie) parts.push(tieShort(tie, name));
  if (evaluation.candidateId !== spark.evaluation.leaderId) parts.push("The editor then revised it once.");
  return parts.join(" ") + fallback;
}

/**
 * AI result layout: the idea, one score, one walkthrough, three more ways to
 * run it, and why it was chosen. Everything else sits in one closed drawer.
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
  const revisedFrom = finalEvaluation.candidateId !== leaderId ? leaderId : null;
  const sources = sourcesForIdea(final, ledger);
  return (
    <>
      {spark.agent?.how === "stopped" && (
        <p className="readout border-l-4 border-ember pl-3 text-ink">Stopped early · {spark.agent.endReason}</p>
      )}
      <Section index={1} title="Spark Score" origin={origin}>
        <SparkScore
          evaluation={finalEvaluation}
          revisedFrom={revisedFrom ? originalEvaluation.score.rankingScore : undefined}
          byAgent={Boolean(spark.agent)}
        />
      </Section>

      <Section index={2} title="How it could play out" origin={origin}>
        <Walkthrough text={final.walkthrough} />
      </Section>

      <Section index={3} title="Three more ways in" origin={origin}>
        <FormatIdeasCompact ideas={final.formatIdeas} />
      </Section>

      <Section index={4} title="Why this idea" origin={origin}>
        <WhyThisIdea
          paragraphs={[
            `${final.whyItWillSpread} ${selectionSentence(spark, finalEvaluation)}`,
            ...(spark.audience && final.audienceConnection ? [`Audience connection: ${final.audienceConnection}`] : []),
            ...(spark.agent?.winnerReach ? [reachSentence(spark.agent.winnerReach)] : []),
          ]}
          sources={sources}
          verified={finalEvaluation.score.relevanceVerified}
          researched={ledger !== null}
          original={final.basis === "original"}
          freshness={freshestSignal(final.groundedIn, ledger)?.freshness ?? null}
          route={spark.agent?.winnerReach?.route}
        />
      </Section>

      <Drawer>
        {spark.longlist && (
          <DrawerPart title={spark.agent ? `The idea wall · ${spark.longlist.ideas.length} ${spark.longlist.ideas.length === 1 ? "idea" : "ideas"} noted` : `The longlist · ${spark.longlist.ideas.length} ideas considered`}>
            <LonglistPanel longlist={spark.longlist} candidates={spark.candidates} signals={ledger?.signals} byAgent={Boolean(spark.agent)} />
          </DrawerPart>
        )}

        <DrawerPart title="Why now">
          <WhyNow text={final.whyNow} />
        </DrawerPart>

        <DrawerPart title="Timing hypothesis">
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-relaxed">{final.timing.hypothesis}</p>
            <div className="flex flex-col gap-1.5 border-l-4 border-hypo pl-4">
              <p className="readout font-bold text-hypo">What would confirm or refute it</p>
              <p className="text-[14px] leading-relaxed">{final.timing.whatWouldConfirm}</p>
            </div>
            <p className="readout text-ink-soft">The AI’s hypothesis about timing. It isn’t scored.</p>
          </div>
        </DrawerPart>

        <DrawerPart title="Signals to verify">
          <SignalsToVerify signals={final.signalsToVerify} />
        </DrawerPart>

        <DrawerPart title="Watch-outs">
          <RiskNotes risks={final.risks} />
        </DrawerPart>

        <DrawerPart title="Strategy and audio">
          <StrategyPanel
            candidate={final}
            evaluation={finalEvaluation}
            ledger={ledger}
            brand={spark.brand}
            platformLabel={platformLabel}
          />
          <AudioApproach candidate={final} />
        </DrawerPart>

        <DrawerPart title={`Evaluation · ${ideasLabel(spark)}`}>
          <Scoreboard report={spark.evaluation} candidates={spark.candidates} revisedFrom={revisedFrom ?? undefined} />
        </DrawerPart>

        <DrawerPart title={spark.candidates.length === 1 ? "The reviewed idea" : `The ${NUMBER_WORDS[spark.candidates.length] ?? spark.candidates.length} reviewed ideas · compare`}>
          <ThreeIdeas spark={spark} ledger={ledger} platformLabel={platformLabel} />
        </DrawerPart>

        <DrawerPart title="Refinement">
          <RefinementPanel refinement={refinement} original={original} originalEvaluation={originalEvaluation} byAgent={Boolean(spark.agent)} />
        </DrawerPart>

        <DrawerPart title="Evidence detail">
          <EvidencePanel spark={spark} />
        </DrawerPart>

        {spark.agent ? <AgentTrace report={spark.agent} /> : <DecisionTrace spark={spark} />}
        <GenerationFooter spark={spark} />
      </Drawer>
    </>
  );
}

/** Day 6: the agent's reach bet for the winner, labeled as a hypothesis. */
function reachSentence(reach: NonNullable<NonNullable<HypothesisSpark["agent"]>["winnerReach"]>): string {
  const route = { proven: "a proven pattern", primed: "a primed signal", original: "an original format" }[reach.route];
  return `The reach bet (the agent's hypothesis, not a forecast): ${route}. ${reach.behaviors} It would be wrong if ${reach.wouldProveWrong.replace(/^./, (c) => c.toLowerCase())}`;
}

/** "all three ideas" for the fixed workflow; the agent may review any number. */
function ideasLabel(spark: HypothesisSpark): string {
  const n = spark.candidates.length;
  if (!spark.agent) return "all three ideas";
  return n === 1 ? "the one reviewed idea" : n === 2 ? "both reviewed ideas" : `all ${NUMBER_WORDS[n] ?? n} reviewed ideas`;
}

/** All reviewed ideas, ranked, each with its full strategy, so alternatives can be inspected. */
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
                  {c.basis === "original" ? "original format · " : ""}
                  {c.territory}
                </span>
                <span className="text-[15px] leading-snug font-semibold">{c.headline}</span>
                <RelevanceBadge verified={e.score.relevanceVerified} />
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

function noLeaderTitle(spark: HypothesisSpark): string {
  if (spark.agent?.how === "abstained") return "The agent didn't recommend an idea";
  if (spark.agent?.how === "stopped") return "Stopped before an idea cleared the bar";
  return "No candidate cleared the bar";
}

function noLeaderText(spark: HypothesisSpark): string {
  const agent = spark.agent;
  if (agent?.how === "abstained") return `In its words: “${agent.endReason}” Nothing is recommended. The full trace is below.`;
  if (agent?.how === "stopped") return `${agent.endReason} No placeholder was substituted. The full trace is below.`;
  const count = NUMBER_WORDS[spark.candidates.length] ?? spark.candidates.length;
  return `All ${count} ideas were rejected by our rules, so none is recommended. The reasons are in the evaluation below. Try another scan, or a different brand or platform.`;
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
        <h2 className="headline text-[42px] text-balance sm:text-[56px]">{noLeaderTitle(spark)}</h2>
        <p className="text-[16px] leading-relaxed">{noLeaderText(spark)}</p>
        <p className="readout text-ink-soft">For: {spark.brand}</p>
      </header>
      {spark.candidates.length > 0 && (
        <Section index={1} title="Evaluation" origin={spark.origin}>
          <Scoreboard report={spark.evaluation} candidates={spark.candidates} />
        </Section>
      )}
      <Section index={spark.candidates.length > 0 ? 2 : 1} title="Evidence" origin={spark.origin}>
        <EvidencePanel spark={spark} />
      </Section>
      {spark.agent ? <AgentTrace report={spark.agent} /> : <DecisionTrace spark={spark} />}
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
      {spark.agent ? ` of a $${spark.agent.ceilingUsd.toFixed(2)} per-scan ceiling` : ""}
    </p>
  );
}

function WhyNow({ text }: { text: string }) {
  return <p className="border-l-4 border-ember pl-4 text-[17px] leading-relaxed font-medium">{text}</p>;
}
