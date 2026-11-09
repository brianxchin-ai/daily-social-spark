/** Persistent notice that the whole app is running on demo content. */
export function DemoBanner() {
  return (
    <div role="note" className="readout w-full bg-demo px-4 py-2 text-center text-[11px] text-surface">
      <span className="font-bold">◆ Demo mode</span>
      <span className="mx-2 opacity-60">/</span>
      Trends, sources, metrics &amp; recommendations are placeholder
      <span className="mx-2 opacity-60">/</span>
      Live research not connected
    </div>
  );
}
