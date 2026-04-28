"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { useSupabase } from "@/components/supabase-session-provider";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import { useWeddingStore } from "@/store/weddingStore";

export default function LoginPage() {
  const router = useRouter();
  const { supabase } = useSupabase();
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
      return;
    }

    const signedInUser = data.user ?? data.session?.user ?? null;

    if (!signedInUser) {
      setErrorMessage("We couldn't load your account. Please try again.");
      setIsLoading(false);
      return;
    }

    try {
      const weddingProfile = await getWeddingProfileForUser(
        supabase,
        signedInUser.id,
      );

      setUser(signedInUser);
      setWeddingProfile(weddingProfile);
      setIsOnboarded(Boolean(weddingProfile));

      router.replace(weddingProfile ? "/" : "/onboarding");
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't load your wedding profile.",
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
  };

  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-[32px] leading-none text-ink">
          Welcome back
        </h1>
        <p className="mt-3 text-[14px] text-ink-muted">Good to see you again</p>
      </div>

      <form className="mt-10" onSubmit={handleSubmit}>
        <div className="space-y-8">
          <input
            aria-label="Email"
            autoComplete="email"
            className="w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-3 text-[14px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-gold"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />

          <input
            aria-label="Password"
            autoComplete="current-password"
            className="w-full border-0 border-b border-[#E8E2D9] bg-transparent px-0 py-3 text-[14px] text-ink outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-gold"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
        </div>

        <button
          className="mt-8 w-full rounded-[4px] bg-ink px-4 py-[14px] text-[14px] font-medium text-cream transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isLoading}
          type="submit"
        >
          {isLoading ? "Signing in..." : "Sign in"}
        </button>

        {errorMessage ? (
          <p className="mt-4 text-sm text-danger">{errorMessage}</p>
        ) : null}
      </form>

      <p className="mt-8 text-[13px] text-ink-muted">
        Don&apos;t have an account?{" "}
        <Link className="text-gold transition-colors hover:text-ink" href="/signup">
          Start planning
        </Link>
      </p>
    </AuthShell>
  );
}
