"use client";

import { useEffect, useState } from "react";
import { SCAN_STEPS, SIMULATED_SCAN_MS } from "@/lib/scan";
import { DemoBadge } from "./DemoBadge";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

/** Simulated tallies — invented numbers that only animate the wait. */
const TALLIES = [
  { label: "Sources checked", target: 48 },
  { label: "Posts sampled", target: 12_400 },
  { label: "Signals scored", target: 212 },
];

/**
 * Simulated scan, staged like a live broadcast: counters tick up, steps
 * check off, and the forecast beam sweeps. Mount a fresh copy per scan.
 */
export function ScanProgress({ brand }: { brand: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / SIMULATED_SCAN_MS);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const eased = 1 - Math.pow(1 - progress, 3);
  const activeStep = Math.min(SCAN_STEPS.length - 1, Math.floor(progress * SCAN_STEPS.length));

  return (
    <div aria-live="polite" aria-busy="true" className="animate-rise motion-reduce:animate-none">
      <StoryCard
        slateLeft={
          <>
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ember motion-reduce:animate-none" aria-hidden />
            Scan in progress
          </>
        }
        slateRight="Simulated"
      >
        <div className="flex flex-col gap-2">
          <p className="readout text-ink-soft">Target</p>
          <p className="headline text-[44px] break-words">{brand}</p>
        </div>

        <TimeRibbon mode="scanning" />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="readout text-ink-soft">Live tally</p>
            <DemoBadge />
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {TALLIES.map((tally) => (
              <div key={tally.label} className="demo-outline flex flex-col gap-1 bg-canvas p-3">
                <dt className="readout text-[10px] text-ink-soft">{tally.label}</dt>
                <dd className="font-mono text-[22px] font-bold tabular-nums sm:text-[28px]">
                  {Math.round(tally.target * eased).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <ol className="flex flex-col gap-1.5 font-mono text-[13px]">
          {SCAN_STEPS.map((label, index) => {
            const status =
              progress >= 1 || index < activeStep ? "done" : index === activeStep ? "active" : "pending";
            return (
              <li
                key={label}
                className={`flex items-center gap-3 ${status === "pending" ? "text-ink-soft/50" : ""}`}
              >
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
