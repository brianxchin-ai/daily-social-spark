import type { HypothesisSpark } from "@/lib/types";

const RELEVANCE_HELP = {
  verified: "The research verified it: a cited, dated source from this idea's own signal shows the behavior is live.",
  judged: "Scored by AI judgment from the research and the model's cultural knowledge. No dated source verified it.",
};

/** Whether the idea's cultural relevance was verified by the research or is AI judgment. A label only. */
export function RelevanceBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`readout inline-flex w-fit items-center gap-1 self-start rounded-sm border px-1.5 py-px text-[10px] font-bold ${
        verified ? "border-hypo bg-hypo text-surface" : "border-dashed border-ink-soft text-ink-soft"
      }`}
      title={verified ? RELEVANCE_HELP.verified : RELEVANCE_HELP.judged}
    >
      {verified ? "✓ Relevance verified" : "◇ AI judgment"}
    </span>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One line on what research informed the scan. "Completed" means the signed
 * ledger checked out; it doesn't mean the idea's trend claims were verified.
 */
export function researchSummary(research: HypothesisSpark["research"]): { tone: "ok" | "warn" | "off"; text: string } {
  if (research.status === "verified") {
    const l = research.ledger;
    return {
      tone: "ok",
      text: `Live research completed: ${plural(l.discovery.searches, "search", "searches")}, ${plural(l.sources.length, "source")}, ${plural(l.signals.length, "signal")}.`,
    };
  }
  if (research.status === "rejected") return { tone: "warn", text: `Research not used: ${research.reason}` };
  if (research.status === "unavailable") return { tone: "warn", text: `No research used: ${research.reason}` };
  return { tone: "off", text: research.reason };
}
