import type { SparkOrigin } from "@/lib/types";

/**
 * Diagonal corner sash for a card, like a "SAMPLE" stamp on a proof. Demo
 * content is marked as such; an AI result is marked as a creative concept,
 * while its research status is shown separately (Evidence-backed, etc.).
 */
export function DemoStamp({ origin = "demo" }: { origin?: SparkOrigin }) {
  const isDemo = origin === "demo";
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 right-0 h-32 w-32 overflow-hidden">
      <div
        className={`readout absolute top-[30px] -right-[38px] w-[176px] rotate-45 py-1 text-center font-bold text-surface shadow-sm ${
          isDemo ? "bg-demo text-[11px] tracking-[0.2em]" : "bg-hypo text-[9px] tracking-[0.08em]"
        }`}
      >
        {isDemo ? "Demo" : "Creative concept"}
      </div>
    </div>
  );
}
