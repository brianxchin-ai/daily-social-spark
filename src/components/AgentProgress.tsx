"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentTraceStep } from "@/lib/types";
import { AgentStepRow } from "./AgentTrace";
import { StoryCard } from "./StoryCard";

/**
 * Day 6: the wait for an agent scan. Instead of a timer-paced bar, it shows
 * each action as the agent takes it, as reported by the server. Nothing here
 * is estimated except the time limit, which is the server's own.
 */
export function AgentProgress({
  brand,
  steps,
  turn,
  onCancel,
}: {
  brand: string;
  steps: AgentTraceStep[];
  turn: number;
  onCancel?: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => setElapsedMs(performance.now() - start), 250);
    return () => clearInterval(timer);
  }, []);

  // Keep the newest action in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [steps.length]);

  const actions = steps.filter((s) => s.actor !== "code" && s.actor !== "model").length;

  return (
    <div aria-busy="true" className="animate-rise motion-reduce:animate-none">
      <StoryCard
        slateLeft={
          <>
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ember motion-reduce:animate-none" aria-hidden />
            Agent at work
          </>
        }
        slateRight="Live call · agent mode"
      >
        <div className="flex flex-col gap-2">
          <p className="readout text-ink-soft">Target</p>
          <p className="headline text-[44px] break-words">{brand}</p>
        </div>

        <dl className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1 bg-canvas p-3">
            <dt className="readout text-ink-soft">Elapsed</dt>
            <dd className="font-mono text-[24px] font-bold tabular-nums">{Math.floor(elapsedMs / 1000)}s</dd>
          </div>
          <div className="flex flex-col gap-1 bg-canvas p-3">
            <dt className="readout text-ink-soft">Turn</dt>
            <dd className="font-mono text-[24px] font-bold tabular-nums">{turn || "—"}</dd>
          </div>
          <div className="flex flex-col gap-1 bg-canvas p-3">
            <dt className="readout text-ink-soft">Actions</dt>
            <dd className="font-mono text-[24px] font-bold tabular-nums">{actions}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <p className="readout text-ink-soft">What the agent is doing</p>
          <ol ref={listRef} aria-live="polite" className="flex max-h-[340px] flex-col gap-3 overflow-y-auto pr-1">
            {steps.length === 0 && <li className="font-mono text-[13px] text-ink-soft">Reading the brief and deciding where to start…</li>}
            {steps.map((step, i) => (
              <AgentStepRow key={`${step.turn}-${i}`} step={step} compact />
            ))}
          </ol>
          <p className="readout text-ink-soft">
            Each line is reported by our code as it happens. Quoted lines are the agent&apos;s stated reasons. Hard limits: $0.75 and 270
            seconds; the cost appears with the result.
          </p>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="readout self-start border-b border-ink-soft pb-px text-ink-soft hover:border-ink hover:text-ink"
          >
            ✕ Cancel scan · Esc
          </button>
        )}
      </StoryCard>
    </div>
  );
}
