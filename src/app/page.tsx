import { DemoBanner } from "@/components/DemoBanner";
import { ScanExperience } from "@/components/ScanExperience";

export default function Home() {
  return (
    <>
      <DemoBanner />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Daily Social Spark</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            One substantiated short-form opportunity likely to spread in the next 24–48 hours.
          </p>
        </header>
        <ScanExperience />
      </main>
    </>
  );
}
