/** Persistent notice that the whole app is running on demo content. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <strong className="font-semibold">Demo mode</strong> — trends, sources,
      metrics and recommendations are placeholder content. Live research is not
      connected yet.
    </div>
  );
}
