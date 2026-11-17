/** One execution, start to finish, as a short treatment. Paragraphs split on blank lines. */
export function Walkthrough({ text }: { text?: string }) {
  const paragraphs = (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) {
    return <p className="text-[14px] leading-relaxed text-ink-soft">No walkthrough was written for this idea.</p>;
  }
  return (
    <div className="flex max-w-[64ch] flex-col gap-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-[16.5px] leading-[1.65]">
          {p}
        </p>
      ))}
    </div>
  );
}
