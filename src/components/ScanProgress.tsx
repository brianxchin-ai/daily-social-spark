"use client";

import { useEffect, useState } from "react";
import { EXPECTED_SCAN_MS, SCAN_STEPS } from "@/lib/scan";
import type { EngineMode } from "@/lib/types";
import { DemoBadge } from "./DemoBadge";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

/** Simulated tallies—invented numbers that only animate the demo wait. */
const TALLIES = [
  { label: "Sources checked", target: 48 },
  { label: "Posts sampled", target: 12_400 },
  { label: "Signals scored", target: 212 },
];

/**
 * The wait, staged like a live broadcast. Demo mode animates invented tallies;
 * Claude mode shows only real facts (elapsed time, model) and a progress bar
 * that eases toward the end without claiming to know when the answer arrives.
 * Mount a fresh copy per scan.
 */
export function ScanProgress({
  brand,
  engine,
  model,
}: {
  brand: string;
  engine: EngineMode;
  model: string | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      setElapsedMs(now - start);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const expected = EXPECTED_SCAN_MS[engine];
  const progress =
    engine === "demo"
      ? Math.min(1, elapsedMs / expected)
      : Math.min(0.95, 1 - Math.exp(-elapsedMs / (expected * 0.6)));
  const eased = 1 - Math.pow(1 - progress, 3);
  const steps = SCAN_STEPS[engine];
  const activeStep = Math.min(steps.length - 1, Math.floor(progress * steps.length));

  return (
    <div aria-live="polite" aria-busy="true" className="animate-rise motion-reduce:animate-none">
      <StoryCard
        slateLeft={
          <>
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ember motion-reduce:animate-none" aria-hidden />
            Scan in progress
          </>
        }
        slateRight={engine === "demo" ? "Simulated" : "Live call"}
      >
        <div className="flex flex-col gap-2">
          <p className="readout text-ink-soft">Target</p>
          <p className="headline text-[44px] break-words">{brand}</p>
        </div>

        {engine === "demo" ? (
          <>
            <TimeRibbon mode="scanning" />
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="readout text-ink-soft">Live tally</p>
                <DemoBadge />
              </div>
              <dl className="grid grid-cols-3 gap-3">
                {TALLIES.map((tally) => (
                  <div key={tally.label} className="demo-outline flex flex-col gap-1 bg-canvas p-3">
                    <dt className="readout text-ink-soft">{tally.label}</dt>
                    <dd className="font-mono text-[22px] font-bold tabular-nums sm:text-[28px]">
                      {Math.round(tally.target * eased).toLocaleString()}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 bg-canvas p-3">
              <dt className="readout text-ink-soft">Elapsed</dt>
              <dd className="font-mono text-[28px] font-bold tabular-nums">{Math.floor(elapsedMs / 1000)}s</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 bg-canvas p-3">
              <dt className="readout text-ink-soft">Model</dt>
              <dd className="font-mono text-[15px] font-bold break-words">{model ?? "Claude"}</dd>
              <dd className="readout text-ink-soft">Up to 6 calls · usually 2–3.5 min</dd>
            </div>
          </dl>
        )}

        <ol className="flex flex-col gap-1.5 font-mono text-[13px]">
          {steps.map((label, index) => {
            const status = progress >= 1 || index < activeStep ? "done" : index === activeStep ? "active" : "pending";
            return (
              <li key={label} className={`flex items-center gap-3 ${status === "pending" ? "text-ink-soft/50" : ""}`}>
                <span aria-hidden className={status === "active" ? "text-ember" : ""}>
                  {status === "done" ? "[✓]" : status === "active" ? "[▸]" : "[ ]"}
                </span>
                <span>
                  {label}
                  {status === "active" && (
                    <span className="animate-blink motion-reduce:animate-none" aria-hidden>
                      _
                    </span>
                  )}
                </span>
                <span className="sr-only">
                  {status === "done" ? " (done)" : status === "active" ? " (in progress)" : ""}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="h-1 w-full bg-canvas" aria-hidden>
          <div className="h-full bg-ember" style={{ width: `${progress * 100}%` }} />
        </div>
      </StoryCard>
    </div>
  );
}
