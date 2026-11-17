import type { DistributionDriver } from "@/lib/spark-schema";
import type { Candidate, Longlist } from "@/lib/types";

const DRIVER_LABEL: Record<DistributionDriver, string> = {
  "watch-time": "Watch time",
  completion: "Completion",
  rewatch: "Rewatch",
  shares: "Shares",
  saves: "Saves",
  comments: "Comments",
  participation: "Participation",
};

/**
 * The 10 ideas the Generator wrote before picking 3, with its distribution
 * bet for each. Picks come first, in pick order. These bets are the AI's
 * judgment about what drives organic reach, never a forecast.
 */
export function LonglistPanel({ longlist, candidates }: { longlist: Longlist; candidates: Candidate[] }) {
  const picks = longlist.ideas
    .filter((i) => i.pick)
    .sort(
      (a, b) =>
        candidates.findIndex((c) => c.id === a.pick!.candidateId) - candidates.findIndex((c) => c.id === b.pick!.candidateId),
    );
  const rest = longlist.ideas.filter((i) => !i.pick);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] leading-relaxed text-ink-soft">
        The Generator wrote these ideas first, then picked the three it believed would earn the most organic
        distribution while staying distinct. Each bet is its hypothesis about watch time, shares, saves, comments
        and participation, not a measured forecast. The independent reviewer then scored only the three picks.
      </p>
      <ol className="flex flex-col divide-y divide-line border border-line">
        {[...picks, ...rest].map((idea) => (
          <li key={idea.id} className={`flex flex-col gap-1.5 p-3 ${idea.pick ? "" : "opacity-80"}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="readout text-ink-soft">{idea.id}</span>
              {idea.pick ? (
                <span className="readout rounded-sm bg-ink px-1.5 py-px text-[10px] font-bold text-surface">✓ Picked</span>
              ) : (
                <span className="readout text-[10px] text-ink-soft">Set aside</span>
              )}
              <span className="readout text-ink-soft">· {idea.territory}</span>
            </div>
            <p className="text-[15px] leading-snug font-semibold">{idea.headline}</p>
            <p className="text-[13.5px] leading-relaxed">{idea.distributionBet}</p>
            <div className="flex flex-wrap gap-1.5">
              {idea.distributionDrivers.map((d) => (
                <span key={d} className="readout border border-line px-1.5 py-px text-[10px]">
                  {DRIVER_LABEL[d] ?? d}
                </span>
              ))}
              {idea.groundedIn.length > 0 && (
                <span className="readout px-1 py-px text-[10px] text-hypo">Built on {idea.groundedIn.join(", ")}</span>
              )}
            </div>
            {idea.pick && <p className="text-[13px] leading-relaxed text-ink-soft">Why it made the cut: {idea.pick.reason}</p>}
          </li>
        ))}
      </ol>
      {longlist.setAside && (
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Why the others were set aside:</span> {longlist.setAside}
        </p>
      )}
    </div>
  );
}
