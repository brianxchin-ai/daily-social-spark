/** Diagonal corner sash for a card, like a "SAMPLE" stamp on a proof. */
export function DemoStamp() {
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 right-0 h-28 w-28 overflow-hidden">
      <div className="readout absolute top-[22px] -right-[34px] w-[150px] rotate-45 bg-demo py-1 text-center text-[11px] font-bold tracking-[0.2em] text-surface shadow-sm">
        Demo
      </div>
    </div>
  );
}
