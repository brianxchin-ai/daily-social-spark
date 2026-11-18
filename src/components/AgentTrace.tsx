import type { AgentReport, AgentTraceStep } from "@/lib/types";

/**
 * Day 6: what the agent did, step by step. Every line comes from code's
 * record of the run: the action, the agent's own stated reason (quoted, and
 * labeled as such), and what code found. The agent's hidden reasoning is
 * never shown or paraphrased.
 */

const HOW: Record<AgentReport["how"], string> = {
  finished: "Finished by the agent",
  abstained: "The agent abstained",
  stopped: "Stopped by code",
};

const HYPOTHESIS_LABEL = { open: "left open", supported: "supported", refuted: "refuted", dropped: "dropped" } as const;

const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function marker(step: AgentTraceStep): { glyph: string; tone: string } {
  if (step.changedCourse) return { glyph: "↻", tone: "text-ember" };
  if (step.actor === "code" || step.actor === "model") return { glyph: "◆", tone: "text-ink-soft" };
  return step.ok ? { glyph: "✓", tone: "text-ink" } : { glyph: "✕", tone: "text-demo" };
}

/** One step, used both live (while the agent works) and in the drawer. */
export function AgentStepRow({ step, compact = false }: { step: AgentTraceStep; compact?: boolean }) {
  const m = marker(step);
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden className={`shrink-0 font-mono text-[13px] whitespace-nowrap ${m.tone}`}>
        {m.glyph}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[13px] break-words">
          <span className="text-ink-soft">T{step.turn} · </span>
          {step.action}
        </span>
        {step.statedReason && (
          <span className="text-[13px] leading-snug text-ink-soft italic break-words">
            <span className="sr-only">Agent&apos;s stated reason: </span>“{step.statedReason}”
          </span>
        )}
        <span className="text-[13px] leading-snug break-words">{step.result}</span>
        {step.changedCourse && <span className="readout text-ember">Changed course · {step.changedCourse}</span>}
        {!compact &&
          step.flags.slice(0, 2).map((f) => (
            <span key={f} className="text-[12px] leading-snug text-ink-soft break-words">
              ! {f}
            </span>
          ))}
        {!compact && step.costUsd !== null && step.costUsd > 0 && (
          <span className="readout text-ink-soft">≈${step.costUsd.toFixed(3)} · at {seconds(step.atMs)}</span>
        )}
      </span>
    </li>
  );
}

/** The full trace, for the "How we got here" drawer. */
export function AgentTrace({ report }: { report: AgentReport }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="readout border-t border-line pt-3 font-bold">Agent trace · what the agent did, and why</h4>
      <p className="text-[14px] leading-relaxed">
        <span className="font-semibold">{HOW[report.how]}.</span> {report.endReason}
      </p>
      <p className="readout text-ink-soft">
        {[
          count(report.turns, "turn"),
          count(report.steps.length, "action"),
          count(report.counts.searches, "search", "searches"),
          count(report.counts.reads, "page read"),
          count(report.counts.gutChecks ?? 0, "gut-check"),
          count(report.counts.evaluations, "review round"),
          count(report.counts.rescores, "revision"),
          count(report.changesOfCourse, "change of course", "changes of course"),
        ].join(" · ")}{" "}
        · ≈${report.spentUsd.toFixed(3)} of ${report.ceilingUsd.toFixed(2)} · {seconds(report.elapsedMs)}
        {report.uncertainCalls > 0 ? ` · ${report.uncertainCalls} call(s) charged in full (no readable bill)` : ""}
      </p>
      {report.routeDecision && (
        <p className="border-l-4 border-line pl-4 text-[14px] leading-relaxed">
          <span className="readout block text-ink-soft">Why this route, in the agent&apos;s words</span>
          “{report.routeDecision}”
        </p>
      )}
      {report.comparison && (
        <p className="border-l-4 border-line pl-4 text-[14px] leading-relaxed">
          <span className="readout block text-ink-soft">Why this idea over the alternatives, in the agent&apos;s words</span>
          “{report.comparison}”
        </p>
      )}
      {report.tieJudgment && (
        <p className="border-l-4 border-ember pl-4 text-[14px] leading-relaxed">
          <span className="readout block text-ember">Creative judgment, not data</span>
          The top ideas tied on score, so the agent chose: “{report.tieJudgment.note}”
        </p>
      )}
      {report.hypotheses && report.hypotheses.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="readout text-ink-soft">The agent&apos;s working hypotheses</p>
          <ul className="flex flex-col gap-1.5">
            {report.hypotheses.map((h) => (
              <li key={h.id} className="text-[14px] leading-snug">
                <span className={`readout mr-2 ${h.status === "supported" ? "text-hypo" : h.status === "refuted" ? "text-demo" : "text-ink-soft"}`}>
                  {h.id} · {HYPOTHESIS_LABEL[h.status]}
                </span>
                “{h.statement}”
                {h.note && (
                  <span className="block text-[13px] text-ink-soft">
                    {h.note}
                    {h.evidence.length > 0 ? ` (${h.evidence.join(", ")})` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[12px] leading-snug text-ink-soft">
        Quoted lines are the agent&apos;s own stated reasons. Everything else is what our code recorded: what each action did, what it found,
        and the rules it enforced. ↻ marks a change of course; ◆ marks the line producer (our code) stepping in.
      </p>
      <ol className="flex flex-col gap-3">
        {report.steps.map((step, i) => (
          <AgentStepRow key={`${step.turn}-${i}`} step={step} />
        ))}
      </ol>
    </section>
  );
}
