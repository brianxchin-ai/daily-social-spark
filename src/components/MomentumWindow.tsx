import type { MomentumWindow as Window } from "@/lib/types";

const STAGE_LABEL: Record<Window["stage"], string> = {
  rising: "Rising",
  accelerating: "Accelerating",
  "near-peak": "Near peak",
};

/** The 24–48h window: when it peaks and when it closes. */
export function MomentumWindow({ momentum }: { momentum: Window }) {
  return (
    <dl className="grid grid-cols-3 gap-4 text-sm">
      <div>
        <dt className="text-neutral-500 dark:text-neutral-400">Stage</dt>
        <dd className="font-medium">{STAGE_LABEL[momentum.stage]}</dd>
      </div>
      <div>
        <dt className="text-neutral-500 dark:text-neutral-400">Expected peak</dt>
        <dd className="font-medium">~{momentum.peakInHours}h</dd>
      </div>
      <div>
        <dt className="text-neutral-500 dark:text-neutral-400">Window closes</dt>
        <dd className="font-medium">~{momentum.closesInHours}h</dd>
      </div>
    </dl>
  );
}
