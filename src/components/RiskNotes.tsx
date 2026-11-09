/** Watch-outs before acting on the spark. */
export function RiskNotes({ risks }: { risks: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
      {risks.map((risk) => (
        <li key={risk}>{risk}</li>
      ))}
    </ul>
  );
}
