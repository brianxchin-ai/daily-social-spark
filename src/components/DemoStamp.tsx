import type { SparkOrigin } from "@/lib/types";

/** Diagonal corner sash for a card, like a "SAMPLE" stamp on a proof. */
export function DemoStamp({ origin = "demo" }: { origin?: SparkOrigin }) {
  const isDemo = origin === "demo";
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 right-0 h-28 w-28 overflow-hidden">
      <div
        className={`readout absolute top-[22px] -right-[34px] w-[150px] rotate-45 py-1 text-center font-bold text-surface shadow-sm ${
          isDemo ? "bg-demo text-[11px] tracking-[0.2em]" : "bg-hypo text-[10px] tracking-[0.12em]"
        }`}
      >
        {isDemo ? "Demo" : "Hypothesis"}
      </div>
    </div>
  );
}
