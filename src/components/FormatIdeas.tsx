import type { FormatIdea } from "@/lib/types";

/** Concrete creative executions with a suggested opening hook. */
export function FormatIdeas({ ideas }: { ideas: FormatIdea[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {ideas.map((idea) => (
        <li key={idea.title} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <p className="font-medium">{idea.title}</p>
          <p className="italic">{idea.hook}</p>
          <p className="text-neutral-600 dark:text-neutral-300">{idea.description}</p>
        </li>
      ))}
    </ul>
  );
}
