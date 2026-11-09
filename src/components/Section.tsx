import type { ReactNode } from "react";
import { DemoBadge } from "./DemoBadge";

/** A titled block inside the story card, with a channel-style number. */
export function Section({
  index,
  title,
  isDemo,
  children,
}: {
  index: number;
  title: string;
  isDemo: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-t border-line pt-4">
        <h3 className="readout font-bold">
          <span className="text-ember">{String(index).padStart(2, "0")}</span> / {title}
        </h3>
        <DemoBadge show={isDemo} />
      </div>
      {children}
    </section>
  );
}
