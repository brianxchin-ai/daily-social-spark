"use client";

import { useEffect, useState } from "react";
import { SCAN_STEPS, SIMULATED_SCAN_MS } from "@/lib/scan";

/**
 * Simulated loading sequence. Steps advance on a timer that roughly
 * matches the simulated scan length. Mount a fresh copy per scan.
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
      className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
    >
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
        Scanning for <span className="font-medium">{brand}</span>
        <span className="ml-2 text-xs">(simulated)</span>
      </p>
      <ol className="flex flex-col gap-2">
        {SCAN_STEPS.map((label, index) => {
          const status =
            index < activeStep ? "done" : index === activeStep ? "active" : "pending";
          return (
            <li
              key={label}
              className={`flex items-center gap-2 text-sm ${
                status === "pending" ? "text-neutral-400 dark:text-neutral-600" : ""
              }`}
            >
              <span aria-hidden className="w-4 text-center">
                {status === "done" ? "✓" : status === "active" ? "…" : "·"}
              </span>
              {label}
              <span className="sr-only">
                {status === "done" ? " (done)" : status === "active" ? " (in progress)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
