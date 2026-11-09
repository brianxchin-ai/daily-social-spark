/** Watch-outs before acting on the spark. */
export function RiskNotes({ risks }: { risks: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {risks.map((risk) => (
        <li key={risk} className="flex gap-3 text-[14px] leading-snug">
          <span aria-hidden className="font-mono font-bold text-ember">!</span>
          {risk}
        </li>
      ))}
    </ul>
  );
}
