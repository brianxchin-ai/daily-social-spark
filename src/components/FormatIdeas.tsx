import type { FormatIdea } from "@/lib/types";

const FRAME_BACKGROUNDS = [
  "linear-gradient(160deg, #1b1d22 0%, #3b2f5c 55%, #ff4d1a 135%)",
  "linear-gradient(200deg, #0f1113 0%, #173a3f 60%, #ff8a3d 145%)",
  "linear-gradient(170deg, #2a1610 0%, #0f1113 60%, #5a45dc 140%)",
];

/** Creative ideas as vertical storyboard frames with the hook as on-screen text. */
export function FormatIdeas({ ideas }: { ideas: FormatIdea[] }) {
  return (
    <ul className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-3 sm:-mx-7 sm:px-7">
      {ideas.map((idea, index) => (
        <li key={idea.title} className="flex w-[168px] shrink-0 snap-start flex-col gap-3">
          <div
            className="relative flex aspect-[9/16] flex-col justify-between overflow-hidden rounded-xl p-3 text-white"
            style={{ background: FRAME_BACKGROUNDS[index % FRAME_BACKGROUNDS.length] }}
          >
            <div className="readout flex justify-between text-[10px] text-white/70">
              <span>Frame {String(index + 1).padStart(2, "0")}</span>
              <span>0:0{index + 1}</span>
            </div>
            <p className="text-center text-[15px] leading-[1.5] font-bold">
              <span className="box-decoration-clone rounded-[3px] bg-white px-1.5 py-0.5 text-[#0f1113]">
                {idea.hook.replace(/[“”]/g, "")}
              </span>
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col items-end gap-2 text-[13px] text-white/80" aria-hidden>
                <span>♥</span>
                <span>💬</span>
                <span>↗</span>
              </div>
              <div className="h-0.5 w-full bg-white/25" aria-hidden>
                <div className="h-full bg-white" style={{ width: `${30 + index * 25}%` }} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <p className="headline text-[22px]">{idea.title}</p>
            <p className="text-[13px] leading-snug text-ink-soft">{idea.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
