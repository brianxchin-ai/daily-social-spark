import type { EvidenceStatus } from "@/lib/evaluation/scoring";
import type { HypothesisSpark } from "@/lib/types";

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  "evidence-backed": "Evidence-backed",
  "partially-evidenced": "Partially evidenced",
  "unverified-hypothesis": "Unverified creative hypothesis",
};

const STATUS_HELP: Record<EvidenceStatus, string> = {
  "evidence-backed": "Cultural relevance and emerging momentum were both verified from cited, dated sources.",
  "partially-evidenced": "One of the two evidence checks passed; the other couldn't be confirmed from dated sources.",
  "unverified-hypothesis":
    "The research couldn't confirm, from dated sources, that this is a current or growing trend. The idea may still be strong: treat it as a creative hypothesis and check it before you act.",
};

/** How much of a recommendation rests on verified evidence. */
export function StatusBadge({ status, size = "sm" }: { status: EvidenceStatus; size?: "sm" | "md" }) {
  const tone =
    status === "evidence-backed"
      ? "border-hypo bg-hypo text-surface"
      : status === "partially-evidenced"
        ? "border-hypo text-hypo"
        : "border-dashed border-ink-soft text-ink-soft";
  return (
    <span
      className={`readout inline-flex w-fit items-center gap-1 self-start rounded-sm border px-1.5 py-px font-bold ${tone} ${size === "md" ? "text-[11px]" : "text-[10px]"}`}
      title={STATUS_HELP[status]}
    >
      {status === "evidence-backed" ? "✓" : status === "partially-evidenced" ? "◐" : "◇"} {STATUS_LABEL[status]}
    </span>
  );
}

export function statusHelp(status: EvidenceStatus): string {
  return STATUS_HELP[status];
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
