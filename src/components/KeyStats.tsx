import type { MomentumWindow } from "@/lib/types";
import { DemoBadge } from "./DemoBadge";

const STAGE_LABEL: Record<MomentumWindow["stage"], string> = {
  rising: "Rising",
  accelerating: "Accelerating",
  "near-peak": "Near peak",
};

/** Big-number strip: confidence plus the 24–48h momentum window. */
export function KeyStats({
  confidence,
  rationale,
  momentum,
  isDemo,
}: {
  confidence: number;
  rationale: string;
  momentum: MomentumWindow;
  isDemo: boolean;
}) {
  const score = Math.max(0, Math.min(100, confidence));
  const stats = [
    { label: "Expected peak", value: `${momentum.peakInHours}h`, note: "from now" },
    { label: "Window closes", value: `${momentum.closesInHours}h`, note: "after that, it's late" },
    { label: "Stage", value: STAGE_LABEL[momentum.stage], note: "momentum today", small: true },
  ];

  return (
    <div className="grid border-t border-rule sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-2 py-6 sm:pr-6">
        <div className="flex items-center gap-2">
          <p className="eyebrow">Confidence</p>
          <DemoBadge show={isDemo} />
        </div>
        <p className="text-[52px] leading-none font-bold tracking-[-0.03em]">
          {score}
          <span className="ml-1 text-xl font-semibold tracking-normal text-ink-soft">/100</span>
        </p>
        <div
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score}
          className="h-0.5 w-full bg-rule"
        >
          <div className="h-full bg-accent" style={{ width: `${score}%` }} />
        </div>
        <p className="font-serif text-[17px] leading-snug text-ink-soft">{rationale}</p>
      </div>
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col gap-2 border-t border-rule py-6 sm:border-t-0 sm:border-l sm:px-6"
        >
          <div className="flex items-center gap-2">
            <p className="eyebrow">{stat.label}</p>
            <DemoBadge show={isDemo} />
          </div>
          <p
            className={`leading-none font-bold tracking-[-0.03em] ${
              stat.small ? "text-[34px] sm:pt-[18px]" : "text-[52px]"
            }`}
          >
            {stat.value}
          </p>
          <p className="font-serif text-[17px] text-ink-soft">{stat.note}</p>
        </div>
      ))}
    </div>
  );
}
