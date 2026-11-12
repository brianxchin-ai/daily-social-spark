"use client";

import { useEffect, useRef, useState } from "react";
import { localDate, localTime, runScan, ScanCanceled, ScanError, ScanLimited, type BetaLimits, type ScanPhase } from "@/lib/scan";
import type { Platform, Spark } from "@/lib/types";
import { useEngineStatus } from "@/lib/use-engine-status";
import { ScanForm } from "./ScanForm";
import { ScanProgress } from "./ScanProgress";
import { SparkResult } from "./SparkResult";
import { StoryCard } from "./StoryCard";
import { TimeRibbon } from "./TimeRibbon";

type ScanState =
  | { status: "idle" }
  | { status: "scanning"; brand: string; runId: number }
  | { status: "done"; spark: Spark }
  | { status: "error"; message: string; limit: string | null };

/** The card heading for each kind of usage refusal. */
const LIMIT_SLATES: Record<string, string> = {
  daily: "◆ Daily limit reached",
  network: "◆ Daily limit reached",
  budget: "◆ Beta budget reached",
  busy: "◆ Scan already running",
  handoff: "◆ Start a new scan",
  unavailable: "⚠ Live scans paused",
};

/** One plain line about the visitor's public-beta allowance. */
function allowanceLine(limits: BetaLimits): string {
  if (limits.available === false) return "⚠ Live scans are paused: usage tracking is unavailable right now.";
  if (limits.budgetAvailable === false) {
    return `⚠ Live scans are paused: the beta's shared budget is used up. They resume ${limits.budgetResetsAt ? localDate(limits.budgetResetsAt) : "next cycle"}.`;
  }
  const resets = limits.resetsAt ? ` · resets ${localTime(limits.resetsAt)}` : "";
  const noun = limits.limit === 1 ? "scan" : "scans";
  if (limits.remaining === 0) return `◆ You've used today's ${limits.limit} beta ${noun}${resets}`;
  return `◆ Public beta · ${limits.remaining} of ${limits.limit} ${noun} left today${resets}`;
}

/** Owns the scan flow: control deck on the left, the story card stage on the right. */
export function ScanExperience() {
  const [brand, setBrand] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const [phase, setPhase] = useState<ScanPhase>("research");
  const latestRun = useRef(0);
  const cancelRef = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Bumped after every scan, so the beta allowance shown on the page stays current.
  const [statusKey, setStatusKey] = useState(0);
  const engineStatus = useEngineStatus(statusKey);

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
    const controller = new AbortController();
    cancelRef.current = controller;
    setNotice(null);
    setState({ status: "scanning", brand: brand.trim(), runId });
    try {
      setPhase("research");
      const spark = await runScan(
        { brand, platform },
        (p) => {
          if (runId === latestRun.current) setPhase(p);
        },
        controller.signal,
      );
      if (runId === latestRun.current) setState({ status: "done", spark });
    } catch (error) {
      if (error instanceof ScanCanceled || runId !== latestRun.current) return;
      const message =
        error instanceof ScanError ? error.message : "Something went wrong. Please try again.";
      setState({ status: "error", message, limit: error instanceof ScanLimited ? error.kind : null });
    } finally {
      setStatusKey((k) => k + 1);
    }
  }

  /** Stop the scan in progress and return to the start screen. Nothing is retried. */
  function cancelScan() {
    cancelRef.current?.abort();
    cancelRef.current = null;
    latestRun.current++; // any late answer from the canceled run is ignored
    setState({ status: "idle" });
    setNotice("Scan canceled. Nothing was retried.");
  }

  // Esc cancels a scan in progress.
  useEffect(() => {
    if (state.status !== "scanning") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelScan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.status]);

  // Once a scan starts, the masthead steps back so the Spark is the loudest thing on the page.
  const hasRun = state.status !== "idle";

  return (
    <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-8">
        <div className="flex flex-col gap-4">
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
            A creative head start on social. Discover the top short-form opportunity informed by cultural and
            platform signals.
          </p>
        </div>
        <ScanForm
          brand={brand}
          platform={platform}
          isScanning={state.status === "scanning"}
          onCancel={cancelScan}
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
            {notice && (
              <p role="status" className="readout font-bold text-ink">
                ✕ {notice}
              </p>
            )}
            <p className="headline text-[44px] text-ink-soft/40">
              Your spark
              <br />
              lands here
            </p>
            {engineStatus?.engine !== "claude" && <TimeRibbon mode="idle" />}
            <p className="readout text-ink-soft">
              Name a brand → pick a platform → run scan
            </p>
            {engineStatus?.engine === "claude" && (
              <p className="readout text-hypo">
                ◇ Claude engine · each scan makes live, paid calls to {engineStatus.model}
                {engineStatus.research === "live" ? ", starting with live web research" : ""}
              </p>
            )}
            {engineStatus?.engine === "claude" && engineStatus.limits?.enforced && (
              <p className="readout font-bold text-ink">{allowanceLine(engineStatus.limits)}</p>
            )}
          </StoryCard>
        )}
        {state.status === "scanning" && (
          <ScanProgress
            key={state.runId}
            brand={state.brand}
            engine={engineStatus?.engine ?? "demo"}
            model={engineStatus?.model ?? null}
            researchLive={engineStatus?.research === "live"}
            phase={phase}
            onCancel={cancelScan}
          />
        )}
        {state.status === "error" && (
          <StoryCard dashed slateLeft={state.limit ? LIMIT_SLATES[state.limit] ?? "◆ Scan not started" : "⚠ Scan failed"}>
            <p role="alert" className="text-[15px]">
              {state.message}
            </p>
            {state.limit === null && (
              <p className="readout text-ink-soft">
                No placeholder content was substituted. Fix the issue above and run the scan again.
              </p>
            )}
            {(state.limit === "daily" || state.limit === "network" || state.limit === "budget") && (
              <p className="readout text-ink-soft">Public-beta limits keep live scans affordable for everyone.</p>
            )}
          </StoryCard>
        )}
        {state.status === "done" && <SparkResult key={state.spark.id} spark={state.spark} />}
      </div>
    </div>
  );
}
