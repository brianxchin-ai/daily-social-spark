/** Small label marking placeholder content. Hidden when content is live. */
export function DemoBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="inline-flex items-center rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300"
      title="Placeholder content — live research is not connected yet"
    >
      Demo
    </span>
  );
}
