import type { RevisionChecks } from "../evaluation/scoring.ts";
import type { RawCitation } from "../research/ledger.ts";
import type { CandidateDraft } from "../spark-schema.ts";
import { longlistIdeas, signal, treatment, uniform } from "./fixtures.ts";
import { CallFailure, type AgentModel, type Billed, type ContentBlock, type ModelRequest, type ModelResponse, type PaidTools } from "./loop.ts";

/**
 * Stand-ins for the AI and the paid tools, for simulated runs. No network,
 * no cost. The "director" below is a small rule-based policy, not an AI: it
 * exists to show that the loop lets different circumstances produce
 * different paths, changes of course, and clean stops at the limits.
 */

let nextId = 0;
export function toolUse(name: string, input: Record<string, unknown>): ContentBlock {
  return { type: "tool_use", id: `toolu_${++nextId}`, name, input };
}

export const TURN_USAGE = { inputTokens: 600, cacheReadTokens: 6_000, cacheWriteTokens: 1_200, outputTokens: 900 };

/** What the previous turn's tools returned, in order, parsed. */
export function lastResults(request: ModelRequest): Record<string, unknown>[] {
  const last = request.messages[request.messages.length - 1];
  return last.content
    .filter((b) => b.type === "tool_result")
    .map((b) => {
      try {
        return JSON.parse(String(b.content)) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

type Script = (turn: number, results: Record<string, unknown>[], request: ModelRequest) => ContentBlock[] | Partial<ModelResponse> | Error;

/** A model driven by a function of the turn number and the last results. */
export class ScriptedModel implements AgentModel {
  turns = 0;
  readonly requests: ModelRequest[] = [];
  private readonly script: Script;
  private readonly hooks: { beforeTurn?: (turn: number) => void };
  constructor(script: Script, hooks: { beforeTurn?: (turn: number) => void } = {}) {
    this.script = script;
    this.hooks = hooks;
  }

  async turn(request: ModelRequest): Promise<ModelResponse> {
    this.turns += 1;
    // A snapshot: the loop keeps adding to the same message list after this turn.
    this.requests.push(structuredClone(request));
    this.hooks.beforeTurn?.(this.turns);
    const out = this.script(this.turns, lastResults(request), request);
    if (out instanceof Error) throw out;
    const response: ModelResponse = Array.isArray(out)
      ? { model: "claude-sonnet-5-5", stopReason: "tool_use", content: out, usage: TURN_USAGE }
      : { model: "claude-sonnet-5-5", stopReason: "tool_use", content: [], usage: TURN_USAGE, ...out };
    return response;
  }
}

/* ---------- Paid tools ---------- */

export interface WorldPage {
  results: { url: string; title: string; pageAge: string | null }[];
  citations: RawCitation[];
}

interface FakeToolOptions {
  scoreFor?: (draft: CandidateDraft) => number;
  makeable?: (draft: CandidateDraft) => boolean;
  rescoreScore?: number;
  rescoreChecks?: RevisionChecks;
  onCall?: (kind: string) => void;
}

export class FakeTools implements PaidTools {
  readonly log: string[] = [];
  /** Throw this on the next search, once. */
  failNextSearch: Error | null = null;
  private readonly world: Record<string, WorldPage>;
  private readonly options: FakeToolOptions;
  constructor(world: Record<string, WorldPage>, options: FakeToolOptions = {}) {
    this.world = world;
    this.options = options;
  }

  private billed(input: number, output: number, searches = 0): Billed {
    return { model: "claude-sonnet-5-5", usage: { inputTokens: input, outputTokens: output, webSearches: searches } };
  }

  async search({ query }: { query: string }) {
    this.log.push(`search:${query}`);
    this.options.onCall?.("search");
    if (this.failNextSearch) {
      const e = this.failNextSearch;
      this.failNextSearch = null;
      throw e;
    }
    const key = Object.keys(this.world).find((k) => query.toLowerCase().includes(k));
    const page = key ? this.world[key] : { results: [], citations: [] };
    return { ...page, errorCode: null, billed: this.billed(9_000, 600, 1) };
  }

  async read({ url }: { url: string }) {
    this.log.push(`read:${url}`);
    this.options.onCall?.("read");
    return { citations: [{ url, citedText: "A longer passage from the page, read in full." }], billed: this.billed(7_000, 500) };
  }

  async evaluate({ finalists }: { finalists: { id: string; draft: CandidateDraft }[] }) {
    this.log.push(`evaluate:${finalists.map((f) => f.id).join(",")}`);
    this.options.onCall?.("evaluate");
    return {
      assessments: finalists.map((f, i) => ({
        candidateId: f.id,
        evaluatorLabel: "ABC"[i],
        results: uniform(this.options.scoreFor?.(f.draft) ?? 4),
        meaningfulAudioVariations: 0,
        makeable: this.options.makeable?.(f.draft) ?? true,
        makeableNote: "A phone and an afternoon.",
      })),
      billed: this.billed(12_000, 3_500),
    };
  }

  async rescore() {
    this.log.push("rescore");
    this.options.onCall?.("rescore");
    return {
      assessment: { evaluatorLabel: "A", results: uniform(this.options.rescoreScore ?? 5), meaningfulAudioVariations: 0, makeable: true, makeableNote: "Same shoot." },
      checks: this.options.rescoreChecks ?? { preservesMechanic: true, addressesWeakness: true, noUnsupportedClaims: true },
      checksRationale: "Keeps the mechanic and fixes the open.",
      billed: this.billed(8_000, 1_500),
    };
  }
}

/** A tool failure that might have been billed (a timeout, a dropped connection). */
export const timeoutFailure = () => new CallFailure("The search timed out.", true);

/* ---------- A rule-based director, for path tests ---------- */

const DATE = /(January|February|March|April|May|June|July|August|September|October|November|December)(\s+\d{1,2},)?\s+\d{4}/;

export interface DirectorConfig {
  queries: string[];
  /** Extra searches to try when nothing fresh turns up. */
  fallbackQueries?: string[];
  /** Ground one trend idea (L2) in this signal, e.g. a stale one, to test replacing a pick. */
  riskySignal?: string;
  revise?: boolean;
  finishEarly?: boolean;
  tieNote?: string;
}

/**
 * Reads each tool result and decides the next action from it. Same rules,
 * different evidence → different paths. Not an AI, and not claimed to be.
 */
export class Director {
  stage: "start" | "filing" | "reviewing" | "ideas" | "shortlisting" | "developing" | "scored" | "done" = "start";
  private emitted: string[] = [];
  private searches = 0;
  private fallback: string[];
  private fresh: string[] = [];
  private queue: string[] = [];
  private triedFinish = false;
  private revised = false;
  readonly ideaBasis = new Map<string, { basis: "trend" | "original"; groundedIn: string[]; territory: string }>();
  private unusedOriginals: string[] = [];
  private picks: string[] = [];

  private readonly config: DirectorConfig;
  constructor(config: DirectorConfig) {
    this.config = config;
    this.fallback = [...(config.fallbackQueries ?? [])];
  }

  asModel(hooks?: { beforeTurn?: (turn: number) => void }): ScriptedModel {
    return new ScriptedModel((_turn, results) => this.next(results), hooks);
  }

  private emit(blocks: ContentBlock[]): ContentBlock[] {
    this.emitted = blocks.map((b) => String(b.name));
    return [{ type: "text", text: "Working." }, ...blocks];
  }

  next(results: Record<string, unknown>[]): ContentBlock[] {
    const quotes: { id: string; quote: string }[] = [];
    let flagged: string | null = null;
    let scores: { candidateId: string; rejected: boolean; sparkScore: number }[] | null = null;
    let tied: string[] = [];
    results.forEach((r, i) => {
      const name = this.emitted[i];
      if (name === "web_search" && r.ok) quotes.push(...((r.quotes as { id: string; quote: string }[]) ?? []));
      if (name === "review_evidence") this.fresh = (r.freshSignals as string[]) ?? [];
      if (name === "develop" && r.ok && (r.flags as string[]).some((f) => f.startsWith("REJECTION RISK"))) flagged = String(r.ideaId);
      if (name === "evaluate" && r.ok) {
        scores = r.scores as typeof scores;
        tied = (r.tiedAtTop as string[]) ?? [];
      }
    });

    switch (this.stage) {
      case "start": {
        const qs = this.config.queries.slice(0, 2);
        this.searches += qs.length;
        this.stage = "filing";
        return this.emit(qs.map((q) => toolUse("web_search", { query: q, purpose: "cross-category", why: `Look for live behavior around "${q}".` })));
      }
      case "filing": {
        const dated = quotes.filter((q) => DATE.test(q.quote));
        this.stage = "reviewing";
        return this.emit([
          ...dated.map((q, i) =>
            toolUse("record_signal", { signal: signal(`Signal ${"ABCDEFGH"[i]}`, q.id, q.quote.match(DATE)![0]), categoryTerms: ["coffee"], why: `File what ${q.id} shows.` }),
          ),
          toolUse("review_evidence", { why: "Check what's actually fresh before choosing a direction." }),
        ]);
      }
      case "reviewing": {
        if (this.fresh.length === 0 && this.fallback.length > 0) {
          const q = this.fallback.shift()!;
          this.searches += 1;
          this.stage = "filing";
          return this.emit([toolUse("web_search", { query: q, purpose: "depth", why: "Nothing fresh yet: try a sharper angle." })]);
        }
        this.stage = "ideas";
        return this.next([]);
      }
      case "ideas": {
        const trend = this.fresh[0];
        const ideas = longlistIdeas(10).map((idea, i) => {
          const isTrend = !!trend && i < 5;
          const grounded = isTrend ? [i === 1 && this.config.riskySignal ? this.config.riskySignal : trend] : [];
          return { ...idea, basis: isTrend ? "trend" : "original", groundedIn: grounded };
        });
        ideas.forEach((idea, i) => {
          this.ideaBasis.set(`L${i + 1}`, { basis: idea.basis as "trend" | "original", groundedIn: idea.groundedIn, territory: idea.territory });
          if (idea.basis === "original") this.unusedOriginals.push(`L${i + 1}`);
        });
        this.stage = "shortlisting";
        return this.emit([toolUse("add_ideas", { ideas, why: trend ? `Build on ${trend} and hedge with originals.` : "No fresh trend: lean on original formats." })]);
      }
      case "shortlisting": {
        if (this.config.finishEarly && !this.triedFinish) {
          this.triedFinish = true;
          return this.emit([toolUse("finish", { why: "Try to stop early." })]);
        }
        const trendIds = [...this.ideaBasis].filter(([, v]) => v.basis === "trend").map(([k]) => k);
        this.picks = trendIds.length >= 2 ? [trendIds[0], trendIds[1], this.unusedOriginals.shift()!] : this.unusedOriginals.splice(0, 3);
        this.queue = [...this.picks];
        this.stage = "developing";
        return this.emit([toolUse("shortlist", { picks: this.picks.map((id) => ({ ideaId: id, reason: `Strong for ${id}.` })), setAside: "The rest overlap or are weaker.", why: "Narrow to three distinct bets." })]);
      }
      case "developing": {
        if (flagged) {
          const replacement = this.unusedOriginals.shift()!;
          this.picks = this.picks.map((p) => (p === flagged ? replacement : p));
          this.queue.unshift(replacement);
          return this.emit([
            toolUse("shortlist", { picks: this.picks.map((id) => ({ ideaId: id, reason: `Keep ${id}.` })), setAside: `${flagged} rests on stale evidence.`, why: `Code flagged ${flagged} as a stale trend; swap it for an original.` }),
          ]);
        }
        const next = this.queue.shift();
        if (!next) {
          this.stage = "scored";
          return this.emit([toolUse("evaluate", { why: "All three are developed; get them reviewed." })]);
        }
        const meta = this.ideaBasis.get(next)!;
        const n = Number(next.slice(1));
        return this.emit([
          toolUse("develop", {
            ideaId: next,
            treatment: treatment({
              basis: meta.basis,
              groundedIn: meta.groundedIn,
              evidenceBasis: meta.basis === "trend" ? `${meta.groundedIn[0]} shows the behavior.` : "No live evidence for this scan.",
              headline: `Treatment for ${next}`,
              concept: `A ${meta.territory} built around ${["receipts", "alarms", "playlists", "sticky notes", "group chats", "backpacks", "lunchboxes", "lanyards", "hoodies", "flashcards"][n - 1]}, made for this brand.`,
              trendName: `Format ${n}`,
              territory: meta.territory,
              mechanic: `Mechanic ${["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"][n - 1]} with its own distinct shape.`,
            }),
            why: `Write ${next} in full.`,
          }),
        ]);
      }
      case "scored": {
        const s = scores as { candidateId: string; rejected: boolean; sparkScore: number }[] | null;
        if (s) {
          const alive = s.filter((x) => !x.rejected);
          if (alive.length === 0) {
            this.stage = "done";
            return this.emit([toolUse("abstain", { reason: "Every finalist was rejected by the review." })]);
          }
          if (this.config.revise && !this.revised) {
            this.revised = true;
            const best = alive[0];
            return this.emit([
              toolUse("revise", {
                candidateId: best.candidateId,
                weakness: "The opening takes too long to land.",
                affectedCriterion: "stopPower",
                whatChanged: "Opens on the payoff.",
                revised: treatment({ basis: "original", groundedIn: [], headline: "Sharper open", mechanic: "Mechanic alpha with its own distinct shape." }),
                why: "The hook is the weakest part; one revision could fix it.",
              }),
            ]);
          }
        }
        this.stage = "done";
        const tieBreak = tied.length > 1 ? { candidateId: tied[1], note: this.config.tieNote ?? "Its hook lands faster." } : undefined;
        return this.emit([toolUse("finish", { why: "The scored finalists are strong enough.", ...(tieBreak ? { tieBreak } : {}) })]);
      }
      default:
        return this.emit([toolUse("finish", { why: "Done." })]);
    }
  }
}
