import type { ReactNode } from "react";
import { DemoBadge } from "./DemoBadge";

/** Editorial row: label column on the left, content on the right, hairline above. */
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
    <section className="grid gap-4 border-t border-rule pt-6 md:grid-cols-[200px_1fr] md:gap-12">
      <div className="flex items-start gap-2 md:flex-col">
        <h3 className="eyebrow">{title}</h3>
        <DemoBadge show={isDemo} />
      </div>
      <div>{children}</div>
    </section>
  );
}
