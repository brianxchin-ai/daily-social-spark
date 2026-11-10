import type { SignalToVerify } from "@/lib/types";

/** What a person should check before acting on a hypothesis, styled like the source log. */
export function SignalsToVerify({ signals }: { signals: SignalToVerify[] }) {
  return (
    <ol className="flex flex-col divide-y divide-line border border-dashed border-hypo/60 bg-canvas">
      {signals.map((item, index) => (
        <li key={index} className="flex flex-col gap-1.5 p-3">
          <div className="readout flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
            <span className="font-bold text-hypo">[{String(index + 1).padStart(2, "0")}]</span>
            <span>☐ To verify</span>
          </div>
          <p className="text-[15px] leading-snug font-semibold">{item.signal}</p>
          <p className="text-[14px] leading-relaxed text-ink-soft">{item.whyItMatters}</p>
          <p className="font-mono text-[11px] text-ink-soft">Where to check: {item.whereToCheck}</p>
        </li>
      ))}
    </ol>
  );
}
