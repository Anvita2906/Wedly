"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { useSupabase } from "@/components/supabase-session-provider";
import { useWeddingStore } from "@/store/weddingStore";

export default function SignupPage() {
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
      return;
    }

    const nextUser = data.session?.user ?? data.user ?? null;

    if (!nextUser) {
      setErrorMessage("We couldn't start your account setup. Please try again.");
      setIsLoading(false);
      return;
    }

    setUser(nextUser);
    setWeddingProfile(null);
    setIsOnboarded(false);

    router.replace("/onboarding");
    router.refresh();
    setIsLoading(false);
  };

  return (
    <AuthShell>
      <div>
        <h1 className="font-display text-[32px] leading-none text-ink">
          Create your account
        </h1>
        <p className="mt-3 text-[14px] text-ink-muted">
          Start your wedding journey
        </p>
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
            autoComplete="new-password"
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
          {isLoading ? "Creating your account..." : "Sign up"}
        </button>

        {errorMessage ? (
          <p className="mt-4 text-sm text-danger">{errorMessage}</p>
        ) : null}
      </form>

      <p className="mt-8 text-[13px] text-ink-muted">
        Already have an account?{" "}
        <Link className="text-gold transition-colors hover:text-ink" href="/login">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
