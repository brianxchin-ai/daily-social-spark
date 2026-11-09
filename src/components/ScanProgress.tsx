"use client";

import { useEffect, useState } from "react";
import { SCAN_STEPS, SIMULATED_SCAN_MS } from "@/lib/scan";

/**
 * Simulated loading sequence on a dark panel. Steps advance on a timer
 * that matches the simulated scan length. Mount a fresh copy per scan.
 */
export function ScanProgress({ brand }: { brand: string }) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const stepMs = SIMULATED_SCAN_MS / SCAN_STEPS.length;
    const timer = setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, SCAN_STEPS.length - 1));
    }, stepMs);
    return () => clearInterval(timer);
  }, []);

  return (
    <section
      aria-live="polite"
      aria-busy="true"
      className="animate-rise bg-panel px-6 py-10 text-panel-ink motion-reduce:animate-none sm:px-10"
    >
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-panel-soft">Scanning · simulated</p>
        <p className="eyebrow text-panel-soft">{brand}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {SCAN_STEPS.map((label, index) => {
          const status =
            index < activeStep ? "done" : index === activeStep ? "active" : "pending";
          return (
            <li
              key={label}
              className={`flex items-baseline gap-4 font-serif text-[26px] leading-tight transition-opacity duration-500 sm:text-[32px] ${
                status === "pending" ? "opacity-25" : status === "done" ? "opacity-50" : ""
              }`}
            >
              <span className="eyebrow w-6 shrink-0 font-sans text-panel-soft">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={status === "active" ? "italic" : ""}>
                {label}
                {status === "active" && "…"}
              </span>
              <span className="sr-only">
                {status === "done" ? " (done)" : status === "active" ? " (in progress)" : ""}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 h-px w-full bg-panel-soft/30" aria-hidden>
        <div
          className="h-px origin-left animate-fill bg-accent motion-reduce:animate-none"
          style={{ animationDuration: `${SIMULATED_SCAN_MS}ms` }}
        />
      </div>
    </section>
  );
}
