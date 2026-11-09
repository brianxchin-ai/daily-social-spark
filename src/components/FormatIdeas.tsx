import type { FormatIdea } from "@/lib/types";

/** Concrete creative executions with a suggested opening hook. */
export function FormatIdeas({ ideas }: { ideas: FormatIdea[] }) {
  return (
    <ul className="grid gap-px bg-rule sm:grid-cols-2">
      {ideas.map((idea, index) => (
        <li key={idea.title} className="flex flex-col gap-3 bg-paper p-5 sm:p-6 sm:last:odd:col-span-2">
          <p className="eyebrow text-accent">Idea {String(index + 1).padStart(2, "0")}</p>
          <p className="text-[21px] leading-tight font-semibold tracking-[-0.02em]">{idea.title}</p>
          <p className="font-serif text-[22px] leading-tight italic">{idea.hook}</p>
          <p className="text-[15px] leading-relaxed text-ink-soft">{idea.description}</p>
        </li>
      ))}
    </ul>
  );
}
