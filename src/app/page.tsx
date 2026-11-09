import { DemoBanner } from "@/components/DemoBanner";
import { ScanExperience } from "@/components/ScanExperience";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <DemoBanner />
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-24 sm:px-6">
        <section className="grid gap-10 py-14 md:grid-cols-[1fr_260px] md:gap-16 md:py-20">
          <div className="flex flex-col gap-6">
            <p className="eyebrow text-accent">
              Social-first trend radar / 24–48 hour window
            </p>
            <h1 className="text-[44px] leading-[1.02] font-bold tracking-[-0.025em] sm:text-[62px]">
              One spark worth
              <br className="hidden sm:block" /> chasing today.
            </h1>
            <p className="max-w-xl font-serif text-[22px] leading-snug">
              One substantiated short-form opportunity, likely to spread in the next
              24–48 hours. Evidence included.
            </p>
          </div>
          <aside className="flex flex-col gap-3 border-rule md:border-l md:pl-6">
            <span className="block h-0.5 w-10 bg-accent" aria-hidden />
            <p className="eyebrow text-ink-soft">How it works</p>
            <p className="font-serif text-[22px] leading-[1.15] italic">
              Name the brand. Pick the platform. Get the one idea worth making today.
            </p>
          </aside>
        </section>
        <ScanExperience />
      </main>
    </>
  );
}
