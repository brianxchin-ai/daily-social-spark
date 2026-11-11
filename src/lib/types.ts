/**
 * The Spark "brief": the shape every scan result must follow.
 * The UI depends only on these types, so a real research engine can
 * replace the demo engine later without redesigning the page.
 */

import type {
  AudioRole,
  CandidateScore,
  CriterionId,
  CriterionResult,
  RevisionChecks,
  RevisionDecision,
  ScoreMode,
} from "./evaluation/scoring";
import type { DiversityReport } from "@/lib/evaluation/diversity";
import type { EvidenceLedger } from "@/lib/research/ledger";

export type Platform = "tiktok" | "instagram-reels" | "youtube-shorts";

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "tiktok", label: "TikTok" },
  { id: "instagram-reels", label: "Instagram Reels" },
  { id: "youtube-shorts", label: "YouTube Shorts" },
];

/** What the person asks for when they press Run Scan. */
export interface ScanRequest {
  brand: string;
  platform: Platform;
}

/** How strongly a piece of evidence supports the opportunity. */
export type SignalStrength = "strong" | "moderate" | "emerging";

/** One piece of supporting evidence, shown like a footnote. */
export interface EvidenceSource {
  id: string;
  outlet: string;
  title: string;
  /** Demo sources use example.com and are never rendered as live links. */
  url: string;
  /** Human-readable recency, e.g. "6 hours ago". */
  publishedAgo: string;
  signal: SignalStrength;
  note: string;
}

/** A headline number that backs up the opportunity. */
export interface Metric {
  label: string;
  value: string;
  /** Optional short context, e.g. "vs. last 7 days". */
  context?: string;
}

/** The 24–48 hour window in which acting on the spark makes sense. */
export interface MomentumWindow {
  /** Hours from now until the trend is expected to peak. */
  peakInHours: number;
  /** Hours from now until the opportunity is likely stale. */
  closesInHours: number;
  stage: "rising" | "accelerating" | "near-peak";
}

/** A concrete creative execution idea. */
export interface FormatIdea {
  title: string;
  hook: string;
  description: string;
}

/** Where a result came from. Drives every label the UI shows. */
export type SparkOrigin = "demo" | "ai-hypothesis";

/** Which engine the server is set to use (SPARK_ENGINE). */
export type EngineMode = "demo" | "claude";

/** Timing for an AI hypothesis: hedged reasoning only. No momentum label, no hours. */
export interface TimingHypothesis {
  hypothesis: string;
  whatWouldConfirm: string;
}

/** Something a person should check before acting on a hypothesis. */
export interface SignalToVerify {
  signal: string;
  whereToCheck: string;
  whyItMatters: string;
}


/** One model call's cost: which step, tokens and estimated dollars. */
export interface CallUsage {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** How a result was produced: model, every call, and totals. */
export interface GenerationInfo {
  model: string;
  calls: CallUsage[];
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Placeholder content with invented timing, metrics and sources. */
export interface DemoSpark {
  origin: "demo";
  id: string;
  generatedAt: string;
  brand: string;
  platform: Platform;
  trendName: string;
  headline: string;
  whyItWillSpread: string;
  whyNow: string;
  window: MomentumWindow;
  /** 0–100 */
  confidence: number;
  confidenceRationale: string;
  metrics: Metric[];
  evidence: EvidenceSource[];
  formatIdeas: FormatIdea[];
  risks: string[];
}

/** One AI-generated opportunity. Never self-scored: the evaluator judges it. */
export interface Candidate {
  id: string;
  trendName: string;
  headline: string;
  /** The fuller creative concept behind the short headline. */
  concept: string;
  mechanic: string;
  /** The creative territory in a few words. */
  territory: string;
  /** Ledger signal IDs that directly evidence the mechanism (checked against the ledger). Only these can verify. */
  groundedIn: string[];
  /** Ledger signal IDs used only as context. Never proof of the mechanism. */
  contextIn: string[];
  /** What the Scout's evidence establishes, per the Generator. */
  evidenceBasis: string;
  /** The Generator's own creative inference. */
  creativeLeap: string;
  /** What the execution hypothesizes might work. */
  executionHypothesis: string;
  /** How the platform shapes the hook, pacing, participation and format. */
  platformExecution: string;
  /** Problems our code found in the grounding (unknown IDs, unquoted figures). */
  groundingWarnings?: string[];
  whyItWillSpread: string;
  whyNow: string;
  timing: TimingHypothesis;
  audioRole: AudioRole;
  audioVariations: string[];
  signalsToVerify: SignalToVerify[];
  formatIdeas: FormatIdea[];
  risks: string[];
}

/** The evaluator's judgment of one candidate, plus our code's scoring of it. */
export interface CandidateEvaluation {
  candidateId: string;
  /** The anonymous label the evaluator saw (A/B/C, shuffled). */
  evaluatorLabel: string;
  results: CriterionResult[];
  meaningfulAudioVariations: number;
  score: CandidateScore;
}

export interface EvaluationReport {
  /** Day 2: ranked by Concept Score only; cultural relevance and momentum unverified. */
  mode: ScoreMode;
  /** In rank order: ranked candidates first, then rejected ones. */
  evaluations: CandidateEvaluation[];
  /** Null when no candidate cleared the bar. */
  leaderId: string | null;
  leaderEvidenceBacked: boolean;
}

/** The editor's one round of notes on the leader. */
export interface CritiqueSummary {
  weakness: string;
  affectedCriterion: CriterionId;
  revisionJustified: boolean;
  decisionReason: string;
  changeSummary: string;
}

/** Checkpoint 4: one critique and at most one revision of the leader, fully inspectable. */
export type RefinementReport =
  /** No eligible leader, so nothing was critiqued. */
  | { status: "skipped"; reason: string }
  /** The editor or rescore call failed; the evaluated leader stands, unrevised. */
  | { status: "failed"; step: "editor" | "rescore"; message: string; critique: CritiqueSummary | null }
  | {
      status: "complete";
      originalId: string;
      critique: CritiqueSummary;
      /** Present when the editor wrote a revision (valid or not). */
      revision: {
        candidate: Candidate | null;
        /** Rulebook problems if the revision failed validation (then it was not rescored). */
        validationProblems: string[];
        evaluation: CandidateEvaluation | null;
        checks: RevisionChecks | null;
        checksRationale: string | null;
        /** Day 3: why the original evidence does or doesn't still apply to the revision. */
        evidenceRationale?: string | null;
      } | null;
      decision: RevisionDecision;
    };

/** An AI scan: three candidate hypotheses, evaluated, ranked and refined once. */
export interface HypothesisSpark {
  origin: "ai-hypothesis";
  id: string;
  generatedAt: string;
  brand: string;
  platform: Platform;
  candidates: Candidate[];
  evaluation: EvaluationReport;
  refinement: RefinementReport;
  /** The version presented: the leader, or its revision if it won. Null if none cleared the bar. */
  finalCandidate: Candidate | null;
  generation: GenerationInfo;
  /** Day 3: what research informed this scan, if any. Never "verified" unless the signed ledger checked out. */
  research: ResearchOutcome;
  /** Day 3: code's labels on the range of the three ideas (near-duplicates, unused off-category signals). */
  diversity: DiversityReport;
}

/**
 * - verified: a signed ledger for this brand and platform, unaltered and unexpired.
 * - rejected: a ledger was sent but failed verification; it was not used.
 * - unavailable: research was attempted but didn't produce a ledger.
 * - off: live research isn't enabled.
 */
export type ResearchOutcome =
  | { status: "verified"; ledger: EvidenceLedger; expiresAt: string }
  | { status: "rejected" | "unavailable" | "off"; reason: string };

/** What a scan returns. */
export type Spark = DemoSpark | HypothesisSpark;
