/** Small label marking placeholder content. Hidden when content is live. */
export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="eyebrow inline-flex items-center border border-demo/50 bg-demo-bg px-1.5 py-px text-[10px] text-demo"
      title="Placeholder content — live research is not connected yet"
    >
      Demo
    </span>
  );
}
