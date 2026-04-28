import type { ReactNode } from "react";
import Link from "next/link";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <section className="flex min-h-screen flex-col md:flex-row">
      <div className="relative flex h-[200px] items-center justify-center bg-[#1C1A17] px-8 py-10 md:min-h-screen md:w-1/2">
        <div className="text-center">
          <Link className="inline-flex flex-col items-center" href="/landing">
            <span className="font-display text-[48px] leading-none text-white">
              Wed<span className="text-gold">ly</span>
            </span>
          </Link>

          <blockquote className="mx-auto mt-8 max-w-[320px] font-display text-[20px] italic leading-[1.8] text-[rgba(250,247,242,0.5)]">
            The best thing to hold onto in life is each other.
          </blockquote>
          <p className="mt-4 text-[12px] text-ink-faint">— Audrey Hepburn</p>
        </div>

        <p className="absolute bottom-5 left-6 text-[11px] text-ink-muted">
          © 2025 Wedly
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-cream px-8 py-12 md:w-1/2 md:px-12">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </section>
  );
}
