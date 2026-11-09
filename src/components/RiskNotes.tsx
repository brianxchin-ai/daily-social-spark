/** Watch-outs before acting on the spark. */
export function RiskNotes({ risks }: { risks: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {risks.map((risk) => (
        <li key={risk} className="grid grid-cols-[1.5rem_1fr] font-serif text-[19px] leading-snug">
          <span aria-hidden className="text-accent">—</span>
          {risk}
        </li>
      ))}
    </ul>
  );
}
