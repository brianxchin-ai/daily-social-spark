import type { ReactNode } from "react";
import { DemoBadge } from "./DemoBadge";

/** Titled block used by every part of a result; shows a Demo badge when needed. */
export function Section({
  title,
  isDemo,
  children,
}: {
  title: string;
  isDemo: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {title}
        </h3>
        <DemoBadge show={isDemo} />
      </div>
      {children}
    </section>
  );
}
