import Link from "next/link";
import { ChevronDown } from "lucide-react";

export default function LandingPage() {
  return (
    <main className="bg-cream text-ink">
      <section className="relative flex min-h-screen items-center justify-center px-6 py-12 text-center">
        <Link
          className="absolute left-6 top-6 font-display text-[24px] leading-none text-ink md:left-10 md:top-8"
          href="/landing"
        >
          Wed<span className="text-gold">ly</span>
        </Link>

        <div className="mx-auto max-w-[780px]">
          <p className="text-[11px] uppercase tracking-[0.32em] text-gold">
            AI Wedding Orchestrator
          </p>
          <h1 className="mx-auto mt-6 max-w-[700px] font-display text-[48px] leading-[1.1] text-ink md:text-[72px]">
            Fear nothing. We&apos;ve got your wedding.
          </h1>
          <p className="mx-auto mt-6 max-w-[480px] text-[16px] leading-[1.7] text-ink-muted">
            Wedly thinks ahead, coordinates your vendors, nudges your family and
            makes sure nothing falls through the cracks.
          </p>
          <div className="mt-8">
            <Link
              className="inline-flex rounded-[4px] bg-ink px-10 py-4 font-display text-[18px] text-gold transition-opacity hover:opacity-85"
              href="/signup"
            >
              Start planning my wedding →
            </Link>
          </div>
        </div>

        <a
          aria-label="Scroll to qualities"
          className="landing-scroll-indicator absolute bottom-8 left-1/2 flex -translate-x-1/2 flex-col items-center text-gold"
          href="#qualities"
        >
          <ChevronDown className="h-5 w-5" strokeWidth={1.4} />
        </a>
      </section>

      <section
        className="flex min-h-screen items-center justify-center bg-[#1C1A17] px-6 py-16 text-center"
        id="qualities"
      >
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-10 h-px w-[60px] bg-gold" />
          <div className="flex flex-col items-center justify-center gap-8 md:flex-row md:gap-14 lg:gap-24">
            <p className="font-display text-[34px] leading-none text-gold md:text-[42px]">
              Think ahead
            </p>
            <p className="font-display text-[34px] leading-none text-white md:text-[42px]">
              Coordinate everything
            </p>
            <p className="font-display text-[34px] leading-none text-gold md:text-[42px]">
              Adapt always
            </p>
          </div>
          <p className="mx-auto mt-14 max-w-3xl text-[14px] leading-[1.8] text-ink-faint">
            From booking vendors to nudging family — Wedly orchestrates your
            entire wedding journey.
          </p>
        </div>
      </section>

      <section className="flex min-h-[60vh] flex-col items-center justify-center px-6 pb-8 pt-16 text-center">
        <div>
          <h2 className="font-display text-[38px] leading-[1.1] text-ink md:text-[48px]">
            Your wedding. Perfectly orchestrated.
          </h2>
          <p className="mt-4 text-[14px] text-ink-muted">
            Join couples who plan with confidence, not anxiety.
          </p>
          <div className="mt-8">
            <Link
              className="inline-flex rounded-[4px] bg-ink px-10 py-4 font-display text-[18px] text-gold transition-opacity hover:opacity-85"
              href="/signup"
            >
              Start for free →
            </Link>
          </div>
        </div>

        <p className="mt-auto pt-10 text-[12px] text-ink-faint">© 2025 Wedly</p>
      </section>
    </main>
  );
}
