"use client";

import { useEffect, useState } from "react";
import { DEMO_STEPS, EXPECTED_RESEARCH_MS, EXPECTED_SCAN_MS, type ScanPhase } from "@/lib/scan";
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
  researchLive = false,
  phase = "creative",
  onCancel,
}: {
  brand: string;
  engine: EngineMode;
  model: string | null;
  researchLive?: boolean;
  /** Which request is in flight; reported by the scan itself, not guessed. */
  phase?: ScanPhase;
  onCancel?: () => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phaseStartMs, setPhaseStartMs] = useState<{ phase: ScanPhase; at: number }>({ phase, at: 0 });
  if (phaseStartMs.phase !== phase) setPhaseStartMs({ phase, at: elapsedMs });

  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      setElapsedMs(now - start);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Within the current request, the bar eases toward the end without claiming to know when it finishes.
  const showResearch = engine === "claude" && researchLive;
  const inResearch = showResearch && phase === "research";
  const phaseElapsed = elapsedMs - phaseStartMs.at;
  const expected = inResearch ? EXPECTED_RESEARCH_MS : EXPECTED_SCAN_MS[engine];
  const progress =
    engine === "demo"
      ? Math.min(1, elapsedMs / expected)
      : Math.min(0.95, 1 - Math.exp(-phaseElapsed / (expected * 0.6)));
  const eased = 1 - Math.pow(1 - progress, 3);
  // Demo: invented, time-paced steps. Claude: only the request in flight is known, so
  // progress is shown per request, never as a claim about which model call is running.
  const demoSteps = DEMO_STEPS;
  const activeDemoStep = Math.min(demoSteps.length - 1, Math.floor(progress * demoSteps.length));
  const phases: { label: string; detail: string; status: "done" | "active" | "pending" }[] = [
    ...(showResearch
      ? [{ label: "Request 1 · Research", detail: RESEARCH_DETAIL, status: inResearch ? ("active" as const) : ("done" as const) }]
      : []),
    {
      label: showResearch ? "Request 2 · Creative" : "Creative request",
      detail: CREATIVE_DETAIL,
      status: inResearch ? "pending" : "active",
    },
  ];

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
              <dd className="readout text-ink-soft">
                {showResearch
                  ? `${inResearch ? "Request 1 of 2 · research" : "Request 2 of 2 · creative"} · up to 6 calls · usually about 2 min`
                  : "Research off · up to 4 calls · usually about 1 min"}
              </dd>
            </div>
          </dl>
        )}

        {engine === "demo" ? (
          <ol className="flex flex-col gap-1.5 font-mono text-[13px]">
            {demoSteps.map((label, index) => (
              <ProgressRow
                key={label}
                label={label}
                status={progress >= 1 || index < activeDemoStep ? "done" : index === activeDemoStep ? "active" : "pending"}
              />
            ))}
          </ol>
        ) : (
          <div className="flex flex-col gap-2">
            <ol className="flex flex-col gap-2.5 font-mono text-[13px]">
              {phases.map((p) => (
                <ProgressRow key={p.label} label={p.label} detail={p.detail} status={p.status} />
              ))}
            </ol>
            <p className="readout text-ink-soft">
              The current request is real; steps inside it aren’t reported one by one, and the bar is an estimate.
            </p>
          </div>
        )}

        <div className="h-1 w-full bg-canvas" aria-hidden>
          <div className="h-full bg-ember" style={{ width: `${progress * 100}%` }} />
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

const RESEARCH_DETAIL = "Searching public sources, then filing a checked evidence ledger";
const CREATIVE_DETAIL = "Three ideas, a separate review, ranking by our code, a critique and, if justified, one revision";

function ProgressRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail?: string;
  status: "done" | "active" | "pending";
}) {
  return (
    <li className={`flex items-start gap-3 ${status === "pending" ? "text-ink-soft/50" : ""}`}>
      <span aria-hidden className={`shrink-0 whitespace-nowrap ${status === "active" ? "text-ember" : ""}`}>
        {status === "done" ? "[✓]" : status === "active" ? "[▸]" : "[ ]"}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>
          {label}
          {status === "active" && (
            <span className="animate-blink motion-reduce:animate-none" aria-hidden>
              _
            </span>
          )}
          <span className="sr-only">{status === "done" ? " (done)" : status === "active" ? " (in progress)" : ""}</span>
        </span>
        {detail && <span className="font-sans text-[12px] leading-snug text-ink-soft">{detail}</span>}
      </span>
    </li>
  );
}
