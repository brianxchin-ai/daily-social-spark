import { z } from "zod";
import { formatScore } from "../evaluation/scoring.ts";
import { normalizeUrl, type EvidenceLedger, type RawCitation } from "../research/ledger.ts";
import { validateRevisedCandidate, type CandidateDraft } from "../spark-schema.ts";
import type { Candidate } from "../types.ts";
import type { BilledUsage } from "../usage/pricing.ts";
import { estimateTokens, Governor, STOP_TEXT, type CallPlan, type PaidCallKind } from "./governor.ts";
import { agentSystem, briefMessage } from "./prompt.ts";
import {
  abstain,
  addIdeas,
  develop,
  finish,
  forceFinish,
  parseInput,
  recordSignal,
  reviewEvidence,
  scoreSummary,
  shortlist,
  TOOL_DESCRIPTIONS,
  TOOL_INPUTS,
  TOOL_NAMES,
  type ToolName,
  type ToolOutcome,
} from "./tools.ts";
import { Workspace, type Assessment, type Brief, type Ending } from "./workspace.ts";
import type { RevisionChecks } from "../evaluation/scoring.ts";

/**
 * The agent loop: the creative director picks its next action, code checks
 * the money, time and rules, runs the tool, and reports back. No step order
 * is written here. The loop only ends when the agent finishes or abstains, or
 * when a limit stops it, in which case code finishes the scan itself with no
 * further AI call.
 *
 * The AI connection (`AgentModel`) and the paid tools (`PaidTools`) are
 * passed in, so simulated runs can drive the same loop without any API.
 */

/* ---------- The model connection ---------- */

/** An API content block, passed back exactly as received (thinking blocks included). */
export type ContentBlock = { type: string } & Record<string, unknown>;
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface Billed {
  model: string;
  usage: BilledUsage;
}

export interface ModelResponse extends Billed {
  stopReason: string;
  content: ContentBlock[];
}

/**
 * A paid call that failed. `billed` is set when the API answered (and
 * charged) before the failure; `maybeBilled` when it might have charged
 * without a readable bill (timeout, dropped connection): then the full hold
 * is kept.
 */
export class CallFailure extends Error {
  readonly maybeBilled: boolean;
  readonly billed?: Billed;
  constructor(message: string, maybeBilled: boolean, billed?: Billed) {
    super(message);
    this.name = "CallFailure";
    this.maybeBilled = maybeBilled;
    this.billed = billed;
  }
}

export interface AgentModel {
  turn(request: ModelRequest): Promise<ModelResponse>;
}

/* ---------- The paid tools ---------- */

export interface CallLimits {
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface FinalistForReview {
  id: string;
  draft: CandidateDraft;
  groundedIn: string[];
}

export type AssessmentResult = Omit<Assessment, "round">;

export interface PaidTools {
  search(input: { query: string } & CallLimits): Promise<{
    results: { url: string; title: string; pageAge: string | null }[];
    citations: RawCitation[];
    errorCode: string | null;
    /** The query the search actually ran, if the API reports it. */
    executedQuery?: string | null;
    billed: Billed;
  }>;
  read(input: { url: string; title: string; question: string } & CallLimits): Promise<{ citations: RawCitation[]; billed: Billed }>;
  evaluate(input: { brief: Brief; finalists: FinalistForReview[]; ledger: EvidenceLedger | null } & CallLimits): Promise<{
    assessments: (AssessmentResult & { candidateId: string })[];
    billed: Billed;
  }>;
  rescore(
    input: { brief: Brief; original: CandidateDraft; revised: CandidateDraft; weakness: string; groundedIn: string[]; ledger: EvidenceLedger | null } & CallLimits,
  ): Promise<{ assessment: AssessmentResult; checks: RevisionChecks; checksRationale: string; billed: Billed }>;
}

/** Worst-case shapes of each paid call, before the governor fits them to the budget. */
export const CALL_PLANS = {
  /** One search: a short prompt, the results the server adds, a short summary with quotes. */
  search: { inputTokens: 1_500, maxOutputTokens: 2_000, maxSearches: 1, serverAddedTokens: 25_000 },
  /** One page read: page text capped by the tool, a short answer with quotes. */
  read: { inputTokens: 1_500, maxOutputTokens: 2_000, serverAddedTokens: 12_000 },
  evaluateOutput: 10_000,
  rescoreOutput: 5_000,
  /** Instructions and rubric sent with every review call. */
  reviewOverheadTokens: 5_000,
} as const;

const TIMEOUTS = { turn: 90_000, search: 60_000, read: 45_000, evaluate: 90_000, rescore: 60_000 };

/* ---------- The trace ---------- */

/** One observable action and its result. Written by code, not by the agent. */
export interface TraceStep {
  turn: number;
  /** The tool used, or "code" for something the line producer did. */
  actor: ToolName | "code" | "model";
  /** What happened, in plain words. */
  action: string;
  /** The agent's own stated reason, verbatim, or null. Never its hidden reasoning. */
  statedReason: string | null;
  result: string;
  ok: boolean;
  flags: string[];
  changedCourse: string | null;
  /** Measured cost of this step's paid call, if any. */
  costUsd: number | null;
  /** Milliseconds since the scan started. */
  atMs: number;
}

export interface CallUsage {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearches?: number;
  estimatedCostUsd: number;
}

export type AgentEvent = { type: "step"; step: TraceStep } | { type: "turn"; turn: number };

export interface AgentRun {
  workspace: Workspace;
  winnerId: string | null;
  ending: Ending;
  steps: TraceStep[];
  turns: number;
  calls: CallUsage[];
  snapshot: ReturnType<Governor["snapshot"]>;
  /** Why the run stopped, if a limit (not the agent) ended it. */
  stopReason: ReturnType<Governor["stopped"]>;
}

/* ---------- Tool specs for the API ---------- */

export function toolSpecs(): ToolSpec[] {
  return TOOL_NAMES.map((name) => {
    const schema = z.toJSONSchema(TOOL_INPUTS[name]) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description: TOOL_DESCRIPTIONS[name], input_schema: schema };
  });
}

/* ---------- The loop ---------- */

export async function runAgent(options: {
  brief: Brief;
  model: AgentModel;
  tools: PaidTools;
  governor?: Governor;
  now?: () => Date;
  idPrefix?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}): Promise<AgentRun> {
  const { brief, model, tools, signal } = options;
  const now = options.now ?? (() => new Date());
  const g = options.governor ?? new Governor();
  const ws = new Workspace(brief, { now, idPrefix: options.idPrefix });
  const today = now().toISOString().slice(0, 10);
  const system = agentSystem(brief);
  const specs = toolSpecs();
  const steps: TraceStep[] = [];
  const calls: CallUsage[] = [];
  let turn = 0;
  let winnerId: string | null = null;
  let wrapAnnounced = false;

  const emit = (event: AgentEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A display problem never stops the scan.
    }
  };
  const step = (s: Omit<TraceStep, "turn" | "atMs">) => {
    const full: TraceStep = { ...s, turn, atMs: g.elapsedMs() };
    steps.push(full);
    emit({ type: "step", step: full });
  };
  const bill = (kind: string, ticket: number, billed: Billed): number => {
    const usd = g.settle(ticket, billed);
    const u = billed.usage;
    calls.push({
      step: kind,
      model: billed.model,
      inputTokens: u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0),
      outputTokens: u.outputTokens,
      webSearches: u.webSearches ?? 0,
      estimatedCostUsd: usd,
    });
    return usd;
  };
  /** Close out a failed paid call honestly: its real bill, its full hold, or nothing if it was never sent. */
  const settleFailure = (kind: string, ticket: number, error: unknown): number => {
    if (error instanceof CallFailure && error.billed) return bill(kind, ticket, error.billed);
    if (error instanceof CallFailure && !error.maybeBilled) {
      g.release(ticket);
      return 0;
    }
    const usd = g.settle(ticket, null);
    calls.push({ step: `${kind} (no readable bill; full hold charged)`, model: "unknown", inputTokens: 0, outputTokens: 0, estimatedCostUsd: usd });
    return usd;
  };
  const failureText = (error: unknown) => (error instanceof CallFailure ? error.message : "An unexpected error stopped this call.");

  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: `${briefMessage(brief, today)}\n\n${readout(g, ws)}` }] }];

  /* ----- Paid tools, each asking the governor first ----- */

  const paid = async (
    kind: PaidCallKind,
    callKind: string,
    plan: CallPlan,
    timeoutCap: number,
    run: (limits: CallLimits) => Promise<{ billed: Billed }>,
  ): Promise<{ ok: true; usd: number; value: Awaited<ReturnType<typeof run>> } | { ok: false; problem: string; usd: number }> => {
    const auth = g.authorize(kind, plan);
    if (!auth.ok) return { ok: false, problem: auth.reason, usd: 0 };
    try {
      const value = await run({ maxOutputTokens: auth.maxOutputTokens, timeoutMs: Math.max(1_000, Math.min(timeoutCap, auth.timeLeftMs)), signal });
      return { ok: true, usd: bill(callKind, auth.ticket, value.billed), value };
    } catch (error) {
      return { ok: false, problem: failureText(error), usd: settleFailure(callKind, auth.ticket, error) };
    }
  };

  const reviewPlan = (payload: unknown, output: number): CallPlan => ({
    inputTokens: estimateTokens(JSON.stringify(payload)) + CALL_PLANS.reviewOverheadTokens,
    maxOutputTokens: output,
  });

  async function runTool(name: ToolName, input: unknown): Promise<{ outcome: ToolOutcome; action: string; usd: number | null }> {
    const fail = (problem: string): ToolOutcome => ({ ok: false, forAgent: { ok: false, problem }, result: `Refused: ${problem}`, flags: [], changedCourse: null, ending: null });
    switch (name) {
      case "web_search": {
        const i = input as z.infer<typeof TOOL_INPUTS.web_search>;
        const action = `Searched: "${i.query}"`;
        const startedIdeas = ws.wall.length > 0;
        const r = await paid("search", "search", CALL_PLANS.search, TIMEOUTS.search, (l) => tools.search({ query: i.query, ...l }));
        if (!r.ok) return { outcome: fail(`The search didn't run: ${r.problem}`), action, usd: r.usd };
        const v = r.value as Awaited<ReturnType<PaidTools["search"]>>;
        // The register records the query that actually ran.
        const ran = v.executedQuery?.trim() || i.query;
        const filed = ws.addSearch({ query: ran, purpose: i.purpose, results: v.results, citations: v.citations, errorCode: v.errorCode });
        const flags = [
          ...filed.adjustments,
          ...(v.errorCode ? [`The search reported an error: ${v.errorCode}.`] : []),
          ...(ran !== i.query ? [`The search ran as "${ran}".`] : []),
        ];
        return {
          action,
          usd: r.usd,
          outcome: {
            ok: true,
            forAgent: {
              ok: true,
              sources: filed.newSources.map((s) => ({ id: s.id, domain: s.domain, title: s.title, pageUpdated: s.pageUpdated, setAside: s.setAside })),
              quotes: filed.newCitations.map((c) => ({ id: c.id, sourceId: c.sourceId, quote: c.quote.slice(0, 500) })),
              flags,
            },
            result: `Found ${filed.newSources.length} new source(s) and ${filed.newCitations.length} quotable passage(s).`,
            flags,
            changedCourse: startedIdeas ? "Went back to research after starting on ideas." : null,
            ending: null,
          },
        };
      }
      case "read_source": {
        const i = input as z.infer<typeof TOOL_INPUTS.read_source>;
        const source = ws.sourceById(i.sourceId.trim());
        const action = `Read a source: ${source?.domain ?? i.sourceId}`;
        if (!source) return { outcome: fail(`${i.sourceId} isn't a source any search returned.`), action, usd: null };
        if (source.setAside) return { outcome: fail(`${source.id} was set aside (it contains instructions aimed at AI systems).`), action, usd: null };
        const r = await paid("read", "read", CALL_PLANS.read, TIMEOUTS.read, (l) => tools.read({ url: source.url, title: source.title, question: i.question, ...l }));
        if (!r.ok) return { outcome: fail(`The page read didn't run: ${r.problem}`), action, usd: r.usd };
        const v = r.value as Awaited<ReturnType<PaidTools["read"]>>;
        // Quotes must point at this very page; anything else is dropped by the register.
        const filed = ws.addCitations(v.citations.filter((c) => normalizeUrl(c.url) === normalizeUrl(source.url)));
        return {
          action,
          usd: r.usd,
          outcome: {
            ok: true,
            forAgent: { ok: true, sourceId: source.id, quotes: filed.citations.map((c) => ({ id: c.id, quote: c.quote.slice(0, 500) })), flags: filed.adjustments },
            result: `Read ${source.domain}: ${filed.citations.length} new quotable passage(s).`,
            flags: filed.adjustments,
            changedCourse: null,
            ending: null,
          },
        };
      }
      case "record_signal": {
        const i = input as z.infer<typeof TOOL_INPUTS.record_signal>;
        return { outcome: recordSignal(ws, i), action: `Filed a signal: ${i.signal.name}`, usd: null };
      }
      case "review_evidence":
        return { outcome: reviewEvidence(ws), action: "Reviewed the evidence", usd: null };
      case "add_ideas": {
        const i = input as z.infer<typeof TOOL_INPUTS.add_ideas>;
        return { outcome: addIdeas(ws, i), action: `Added ${i.ideas.length} idea(s) to the longlist`, usd: null };
      }
      case "shortlist": {
        const i = input as z.infer<typeof TOOL_INPUTS.shortlist>;
        return { outcome: shortlist(ws, i), action: `Shortlisted ${i.picks.map((p) => p.ideaId).join(", ")}`, usd: null };
      }
      case "develop": {
        const i = input as z.infer<typeof TOOL_INPUTS.develop>;
        return { outcome: develop(ws, i), action: `Developed ${i.ideaId}`, usd: null };
      }
      case "evaluate": {
        const action = "Sent the finalists to the review panel";
        const ready = ws.readyForEvaluation();
        if (!ready.ok) return { outcome: fail(ready.problem), action, usd: null };
        const finalists = ready.finalists.map((d) => ({ id: d.candidate.id, draft: toDraft(d.candidate), groundedIn: d.candidate.groundedIn }));
        const ledger = ws.ledger();
        const round = g.count("evaluate") + 1;
        const r = await paid("evaluate", "evaluator", reviewPlan({ finalists, ledger }, CALL_PLANS.evaluateOutput), TIMEOUTS.evaluate, (l) =>
          tools.evaluate({ brief, finalists, ledger, ...l }),
        );
        if (!r.ok) return { outcome: fail(`The review didn't run: ${r.problem}`), action, usd: r.usd };
        const v = r.value as Awaited<ReturnType<PaidTools["evaluate"]>>;
        ws.recordAssessments(round, v.assessments);
        const scores = scoreSummary(ws);
        const diversity = ws.diversity().notes;
        const tied = ws.tiedWithLeader();
        return {
          action,
          usd: r.usd,
          outcome: {
            ok: true,
            forAgent: { ok: true, round, scores, tiedAtTop: tied, diversityNotes: diversity },
            result: `Review round ${round}: ${scores
              .map((s) => `${s.candidateId} ${s.rejected ? `rejected (${s.rejectionReasons.join(" ")})` : `${s.sparkScore}`}`)
              .join("; ")}.${tied.length ? ` Exact tie at the top: ${tied.join(", ")}.` : ""}`,
            flags: diversity,
            changedCourse: round > 1 ? "Sent the finalists back for a second review after changing them." : null,
            ending: null,
          },
        };
      }
      case "revise": {
        const i = input as z.infer<typeof TOOL_INPUTS.revise>;
        const action = `Revised ${i.candidateId}`;
        const checked = validateRevisedCandidate(i.revised);
        if (!checked.ok) return { outcome: fail(`The revision didn't pass the format checks: ${checked.problems.slice(0, 4).join("; ")}`), action, usd: null };
        const prep = ws.prepareRevision(i.candidateId.trim());
        if (!prep.ok) return { outcome: fail(prep.problem), action, usd: null };
        const original = prep.original.candidate;
        const ledger = ws.ledger();
        const r = await paid("rescore", "rescore", reviewPlan({ original, revised: checked.value, ledger }, CALL_PLANS.rescoreOutput), TIMEOUTS.rescore, (l) =>
          tools.rescore({ brief, original: toDraft(original), revised: checked.value, weakness: i.weakness, groundedIn: original.groundedIn, ledger, ...l }),
        );
        if (!r.ok) return { outcome: fail(`The rescore didn't run, so the original stands: ${r.problem}`), action, usd: r.usd };
        const v = r.value as Awaited<ReturnType<PaidTools["rescore"]>>;
        const rec = ws.recordRevision({
          originalId: original.id,
          draft: checked.value,
          weakness: i.weakness,
          affectedCriterion: i.affectedCriterion,
          why: i.why,
          whatChanged: i.whatChanged,
          assessment: v.assessment,
          checks: v.checks,
          checksRationale: v.checksRationale,
        });
        const kept = rec.decision.outcome === "kept-revised";
        const gain = rec.decision.gain == null ? "n/a" : `${rec.decision.gain >= 0 ? "+" : ""}${formatScore(rec.decision.gain)}`;
        const failed = rec.decision.checks.filter((c) => !c.passed).map((c) => c.rule);
        return {
          action,
          usd: r.usd,
          outcome: {
            ok: true,
            forAgent: { ok: true, revisedId: rec.revisedId, outcome: rec.decision.outcome, gain: rec.decision.gain, failedRules: failed, checksRationale: v.checksRationale },
            result: kept ? `Revision kept (${gain} points): ${rec.revisedId} replaces ${original.id}.` : `Revision not kept (${gain} points); the original stands. Failed: ${failed.join("; ")}.`,
            flags: [],
            changedCourse: kept ? `Replaced ${original.id} with its revision.` : null,
            ending: null,
          },
        };
      }
      case "finish": {
        const i = input as z.infer<typeof TOOL_INPUTS.finish>;
        const outcome = finish(ws, i);
        if (outcome.ok) winnerId = (outcome.forAgent.winnerId as string | null) ?? null;
        return { outcome, action: "Called finish", usd: null };
      }
      case "abstain": {
        const i = input as z.infer<typeof TOOL_INPUTS.abstain>;
        return { outcome: abstain(ws, i), action: "Abstained", usd: null };
      }
    }
  }

  /** Run one turn's tool calls. Searches and page reads next to each other run at the same time. */
  async function runToolUses(uses: ToolUseBlock[]): Promise<ContentBlock[]> {
    const out: ContentBlock[] = [];
    const resultBlock = (id: string, body: Record<string, unknown>, isError: boolean): ContentBlock => ({
      type: "tool_result",
      tool_use_id: id,
      content: JSON.stringify(body),
      ...(isError ? { is_error: true } : {}),
    });

    type Prepared = { use: ToolUseBlock; name: ToolName; input: unknown; why: string | null } | { use: ToolUseBlock; error: string };
    const prepared: Prepared[] = uses.map((use) => {
      const counted = g.countToolCall();
      if (!counted.ok) return { use, error: counted.reason };
      if (!(TOOL_NAMES as string[]).includes(use.name)) {
        g.recordToolInput(false);
        return { use, error: `There's no tool called ${use.name}.` };
      }
      const name = use.name as ToolName;
      const parsed = parseInput(name, use.input);
      if (!parsed.ok) {
        g.recordToolInput(false);
        return { use, error: parsed.problem };
      }
      g.recordToolInput(true);
      const value = parsed.value as Record<string, unknown>;
      return { use, name, input: value, why: typeof value.why === "string" ? value.why : name === "abstain" ? String(value.reason ?? "") : null };
    });

    let i = 0;
    while (i < prepared.length) {
      // Group neighboring searches and reads so they run in parallel.
      const group: Prepared[] = [prepared[i]];
      const parallel = (p: Prepared) => "name" in p && (p.name === "web_search" || p.name === "read_source");
      if (parallel(prepared[i])) while (i + group.length < prepared.length && parallel(prepared[i + group.length])) group.push(prepared[i + group.length]);
      i += group.length;

      const results = await Promise.all(
        group.map(async (p) => {
          if ("error" in p) {
            step({ actor: "code", action: `Rejected a tool call (${p.use.name})`, statedReason: null, result: p.error, ok: false, flags: [], changedCourse: null, costUsd: null });
            return resultBlock(p.use.id, { ok: false, problem: p.error }, true);
          }
          if (ws.ending) return resultBlock(p.use.id, { ok: false, problem: "The scan has already ended." }, true);
          if (signal?.aborted) return resultBlock(p.use.id, { ok: false, problem: "Scan canceled." }, true);
          const { outcome, action, usd } = await runTool(p.name, p.input);
          step({ actor: p.name, action, statedReason: p.why, result: outcome.result, ok: outcome.ok, flags: outcome.flags, changedCourse: outcome.changedCourse, costUsd: usd });
          return resultBlock(p.use.id, outcome.forAgent, !outcome.ok);
        }),
      );
      out.push(...results);
    }
    return out;
  }

  /* ----- The loop itself ----- */

  while (!ws.ending) {
    if (signal?.aborted) g.halt("canceled");
    if (g.stopped()) break;

    if (g.stage() === "wrap-up" && !wrapAnnounced) {
      wrapAnnounced = true;
      step({ actor: "code", action: "Called wrap-up", statedReason: null, result: wrapText(g), ok: true, flags: [], changedCourse: null, costUsd: null });
    }

    const auth = g.authorize("agent-turn", {
      inputTokens: estimateTokens(system) + estimateTokens(JSON.stringify(specs)) + estimateTokens(JSON.stringify(messages)),
      maxOutputTokens: g.limits.maxTurnOutputTokens,
    });
    if (!auth.ok) break;
    turn += 1;
    emit({ type: "turn", turn });

    let response: ModelResponse;
    try {
      response = await model.turn({ system, messages, tools: specs, maxOutputTokens: auth.maxOutputTokens, timeoutMs: Math.max(1_000, Math.min(TIMEOUTS.turn, auth.timeLeftMs)), signal });
    } catch (error) {
      settleFailure("agent-turn", auth.ticket, error);
      g.halt(signal?.aborted ? "canceled" : "model-error");
      step({ actor: "model", action: "Agent turn failed", statedReason: null, result: failureText(error), ok: false, flags: [], changedCourse: null, costUsd: null });
      break;
    }
    bill("agent-turn", auth.ticket, response);

    if (response.stopReason === "refusal") {
      g.halt("model-refused");
      step({ actor: "model", action: "The agent declined to continue", statedReason: null, result: STOP_TEXT["model-refused"], ok: false, flags: [], changedCourse: null, costUsd: null });
      break;
    }
    if (response.stopReason === "max_tokens") {
      // A cut-off reply may hold half a tool call: none of it is used.
      const ends = g.recordToolInput(false);
      step({ actor: "code", action: "Discarded a cut-off reply", statedReason: null, result: "The agent's reply hit its length limit before finishing, so nothing in it was used.", ok: false, flags: [], changedCourse: null, costUsd: null });
      if (ends) break;
      appendNote(messages, "Your last reply was cut off at its length limit, so none of it was used. Keep each turn shorter: for example, develop one finalist per turn.");
      continue;
    }

    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((b): b is ContentBlock & ToolUseBlock => b.type === "tool_use") as ToolUseBlock[];
    if (uses.length === 0) {
      const ends = g.recordToolInput(false);
      step({ actor: "code", action: "Asked the agent to act", statedReason: null, result: "The agent replied without using a tool.", ok: false, flags: [], changedCourse: null, costUsd: null });
      messages.push({ role: "user", content: [{ type: "text", text: `Every turn must use a tool: keep working, or call finish or abstain.\n\n${readout(g, ws)}` }] });
      if (ends) break;
      continue;
    }

    const results = await runToolUses(uses);
    messages.push({ role: "user", content: [...results, { type: "text", text: readout(g, ws) }] });
  }

  // Stopped by a limit, a failure or a cancel: code finishes the scan with no further AI call.
  const stopReason = ws.ending ? null : (g.stopped() ?? "budget");
  if (!ws.ending) {
    const forced = forceFinish(ws, STOP_TEXT[stopReason!]);
    winnerId = forced.winnerId;
    step({ actor: "code", action: "Stopped the scan", statedReason: null, result: forced.ending.reason, ok: true, flags: [], changedCourse: null, costUsd: null });
  }

  return { workspace: ws, winnerId, ending: ws.ending!, steps, turns: turn, calls, snapshot: g.snapshot(), stopReason };
}

/* ---------- Helpers ---------- */

function toDraft(candidate: Candidate): CandidateDraft {
  const draft: Partial<Candidate> = { ...candidate };
  delete draft.id;
  delete draft.groundingWarnings;
  return draft as CandidateDraft;
}

function appendNote(messages: Message[], text: string): void {
  const last = messages[messages.length - 1];
  last.content = [...last.content, { type: "text", text }];
}

function wrapText(g: Governor): string {
  const reason = g.wrapUpReason();
  const why = { budget: "most of the budget is used", time: "time is running short", turns: "most turns are used", context: "the working notes are long" } as const;
  return `Wrap-up: ${reason ? why[reason] : "limits are near"}. Research is closed; the agent must finish with what it has.`;
}

/** The line producer's readout, sent after every action. Facts only. */
export function readout(g: Governor, ws: Workspace): string {
  const s = g.snapshot();
  const finalists = ws.picks.length
    ? ws
        .finalists()
        .map((d, i) => `${ws.picks[i].ideaId}${d ? ` → ${d.candidate.id}${d.assessment ? " (scored)" : " (developed)"}` : " (not developed)"}`)
        .join(", ")
    : "none yet";
  const lines = [
    `[Readout from code] Spent $${s.spentUsd.toFixed(3)} of $${s.ceilingUsd.toFixed(2)} · ${Math.floor(s.timeLeftMs / 1000)} s left · turn ${s.turns} of ${s.maxTurns} · searches ${s.searches}/${s.maxSearches} · page reads ${s.reads}/${s.maxReads} · review rounds ${s.evaluations}/${s.maxEvaluations} · revisions ${s.rescores}/${s.maxRescores}`,
    `Evidence: ${ws.sources.length} source(s), ${ws.signalDrafts.length} signal(s). Longlist: ${ws.wall.length}. Finalists: ${finalists}.`,
  ];
  if (s.stage === "wrap-up") lines.push(`STAGE: WRAP-UP. ${wrapText(g).replace(/^Wrap-up: /, "")}`);
  return lines.join("\n");
}

/** Measured cost of everything in a run, for the footer. */
export function runCost(calls: CallUsage[]): number {
  return calls.reduce((sum, c) => sum + c.estimatedCostUsd, 0);
}

