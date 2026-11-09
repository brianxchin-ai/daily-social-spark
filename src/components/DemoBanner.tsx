/** Persistent notice that the whole app is running on demo content. */
export function DemoBanner() {
  return (
    <div role="note" className="w-full bg-demo-bg px-4 py-2 text-center text-[13px] text-demo">
      <span className="eyebrow mr-2">Demo mode</span>
      Trends, sources, metrics and recommendations are placeholder content. Live
      research is not connected yet.
    </div>
  );
}
