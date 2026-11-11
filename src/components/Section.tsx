import type { ReactNode } from "react";
import type { SparkOrigin } from "@/lib/types";
import { OriginBadge } from "./DemoBadge";

/** A titled block inside the story card, with a channel-style number. */
export function Section({
  index,
  title,
  origin,
  children,
}: {
  index: number;
  title: string;
  origin: SparkOrigin;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-t border-line pt-4">
        <h3 className="readout font-bold">
          <span className="text-ember">{String(index).padStart(2, "0")}</span> / {title}
        </h3>
        {/* Demo sections keep the label (their content is invented). AI results are labeled once, in the header. */}
        {origin === "demo" && <OriginBadge origin={origin} />}
      </div>
      {children}
    </section>
  );
}
