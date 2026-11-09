"use client";

import { useEffect, useRef, useState } from "react";
import { runScan, ScanError } from "@/lib/scan";
import type { Platform, Spark } from "@/lib/types";
import { ScanForm } from "./ScanForm";
import { ScanProgress } from "./ScanProgress";
import { SparkResult } from "./SparkResult";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

type ScanState =
  | { status: "idle" }
  | { status: "scanning"; brand: string; runId: number }
  | { status: "done"; spark: Spark }
  | { status: "error"; message: string };

/** Owns the scan flow: control deck on the left, the story card stage on the right. */
export function ScanExperience() {
  const [brand, setBrand] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const latestRun = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // On narrow screens the stage sits below the form, so bring it into view.
  useEffect(() => {
    if (state.status === "scanning" && window.innerWidth < 1024) {
      stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [state.status]);

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

  // Once a scan starts, the masthead steps back so the Spark is the loudest thing on the page.
  const hasRun = state.status !== "idle";

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-8">
        <div className="flex flex-col gap-4">
          <p className="readout text-ember">● Social trend radar / 48-hour forecast</p>
          <h1
            className={`headline transition-[font-size] duration-500 motion-reduce:transition-none ${
              hasRun ? "text-[40px] sm:text-[44px]" : "text-[64px] sm:text-[84px]"
            }`}
          >
            Make this
            <br />
            today<span className="text-ember">.</span>
          </h1>
          <p className={`max-w-sm text-[15px] leading-relaxed text-ink-soft ${hasRun ? "hidden" : ""}`}>
            The top short-form opportunity with momentum behind it—informed by cultural,
            algorithmic, and platform signals, with the evidence to back it up.
          </p>
        </div>
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
      </div>

      <div ref={stageRef} className="w-full max-w-[620px] scroll-mt-6 justify-self-center lg:justify-self-start">
        {state.status === "idle" && (
          <StoryCard dashed slateLeft="◌ Awaiting scan" slateRight="Ch. 01">
            <p className="headline text-[44px] text-ink-soft/40">
              Your spark
              <br />
              lands here
            </p>
            <TimeRibbon mode="idle" />
            <p className="readout text-ink-soft">
              Name a brand → pick a platform → run scan
            </p>
          </StoryCard>
        )}
        {state.status === "scanning" && <ScanProgress key={state.runId} brand={state.brand} />}
        {state.status === "error" && (
          <StoryCard dashed slateLeft="⚠ Scan failed">
            <p role="alert" className="text-[15px]">
              {state.message}
            </p>
          </StoryCard>
        )}
        {state.status === "done" && <SparkResult key={state.spark.id} spark={state.spark} />}
      </div>
    </div>
  );
}
