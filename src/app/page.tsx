import { DemoBanner } from "@/components/DemoBanner";
import { ScanExperience } from "@/components/ScanExperience";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <DemoBanner />
      <SiteHeader />
      <main className="mx-auto w-full max-w-7xl px-4 pt-8 pb-24 sm:px-6 lg:pt-12">
        <ScanExperience />
      </main>
    </>
  );
}
