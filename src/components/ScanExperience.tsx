"use client";

import { useRef, useState } from "react";
import { runScan, ScanError } from "@/lib/scan";
import type { Platform, Spark } from "@/lib/types";
import { ScanForm } from "./ScanForm";
import { ScanProgress } from "./ScanProgress";
import { SparkResult } from "./SparkResult";

type ScanState =
  | { status: "idle" }
  | { status: "scanning"; brand: string; runId: number }
  | { status: "done"; spark: Spark }
  | { status: "error"; message: string };

/** Owns the scan flow: form → simulated loading → result. */
export function ScanExperience() {
  const [brand, setBrand] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const latestRun = useRef(0);

  async function handleSubmit() {
    if (!brand.trim()) {
      setValidationMessage("Enter a brand or category to scan.");
      return;
    }
    setValidationMessage(null);

    const runId = ++latestRun.current;
    setState({ status: "scanning", brand: brand.trim(), runId });
    try {
      const spark = await runScan({ brand, platform });
      if (runId === latestRun.current) setState({ status: "done", spark });
    } catch (error) {
      if (runId !== latestRun.current) return;
      const message =
        error instanceof ScanError ? error.message : "Something went wrong. Please try again.";
      setState({ status: "error", message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ScanForm
        brand={brand}
        platform={platform}
        isScanning={state.status === "scanning"}
        validationMessage={validationMessage}
        onBrandChange={(value) => {
          setBrand(value);
          if (validationMessage && value.trim()) setValidationMessage(null);
        }}
        onPlatformChange={setPlatform}
        onSubmit={handleSubmit}
      />

      {state.status === "idle" && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Enter a brand or category, choose a platform, and run a scan to see today&apos;s spark.
        </p>
      )}
      {state.status === "scanning" && <ScanProgress key={state.runId} brand={state.brand} />}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
      {state.status === "done" && <SparkResult spark={state.spark} />}
    </div>
  );
}
