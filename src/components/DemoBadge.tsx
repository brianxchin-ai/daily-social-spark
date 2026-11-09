/** Proof-stamp label marking placeholder content. Hidden when content is live. */
export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="readout inline-flex items-center gap-1 rounded-sm border border-dashed border-demo px-1.5 py-px text-[10px] font-bold text-demo"
      title="Placeholder content—live research is not connected yet"
    >
      ◆ Demo
    </span>
  );
}
