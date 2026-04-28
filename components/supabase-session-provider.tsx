"use client";

import type { Session, User } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import type { WeddingProfile } from "@/lib/supabase/types";
import { getWeddingProfileForUser } from "@/lib/supabase/wedding-profile";
import { useWeddingStore } from "@/store/weddingStore";

interface SupabaseSessionProviderProps {
  children: ReactNode;
  initialSession: Session | null;
  initialUser: User | null;
  initialWeddingProfile: WeddingProfile | null;
}

interface SupabaseSessionContextValue {
  session: Session | null;
  supabase: ReturnType<typeof createClient>;
}

const SupabaseSessionContext = createContext<
  SupabaseSessionContextValue | undefined
>(undefined);

export function SupabaseSessionProvider({
  children,
  initialSession,
  initialUser,
  initialWeddingProfile,
}: SupabaseSessionProviderProps) {
  const [supabase] = useState(() => createClient());
  const [session, setSession] = useState<Session | null>(initialSession);
  const setIsOnboarded = useWeddingStore((state) => state.setIsOnboarded);
  const setPlanningStartDate = useWeddingStore((state) => state.setPlanningStartDate);
  const setUser = useWeddingStore((state) => state.setUser);
  const setWeddingProfile = useWeddingStore((state) => state.setWeddingProfile);

  useEffect(() => {
    startTransition(() => {
      setSession(initialSession);
      setUser(initialUser);
      setWeddingProfile(initialWeddingProfile);
      setIsOnboarded(Boolean(initialWeddingProfile));
    });
  }, [
    initialSession,
    initialUser,
    initialWeddingProfile,
    setIsOnboarded,
    setPlanningStartDate,
    setUser,
    setWeddingProfile,
  ]);

  useEffect(() => {
    let isMounted = true;

    const hydrateInitialContext = async () => {
      const [
        {
          data: { session: nextSession },
        },
        {
          data: { user: authenticatedUser },
        },
      ] = await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()]);

      const nextProfile = authenticatedUser
        ? await getWeddingProfileForUser(supabase, authenticatedUser.id)
        : null;

      if (!isMounted) {
        return;
      }

      startTransition(() => {
        setSession(nextSession);
        setUser(authenticatedUser ?? null);
        setWeddingProfile(nextProfile);
        setIsOnboarded(Boolean(nextProfile));

        if (!authenticatedUser) {
          setPlanningStartDate(null);
        }
      });
    };

    void hydrateInitialContext();

    return () => {
      isMounted = false;
    };
  }, [
    setIsOnboarded,
    setPlanningStartDate,
    setUser,
    setWeddingProfile,
    supabase,
  ]);

  useEffect(() => {
    let isMounted = true;

    const syncAuthenticatedUser = async (nextSession: Session | null) => {
      setSession(nextSession);

      const {
        data: { user: authenticatedUser },
      } = await supabase.auth.getUser();

      const nextProfile = authenticatedUser
        ? await getWeddingProfileForUser(supabase, authenticatedUser.id)
        : null;

      if (!isMounted) {
        return;
      }

      startTransition(() => {
        setUser(authenticatedUser ?? null);
        setWeddingProfile(nextProfile);
        setIsOnboarded(Boolean(nextProfile));

        if (!authenticatedUser) {
          setPlanningStartDate(null);
        }
      });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncAuthenticatedUser(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [setIsOnboarded, setPlanningStartDate, setUser, setWeddingProfile, supabase]);

  return (
    <SupabaseSessionContext.Provider value={{ session, supabase }}>
      {children}
    </SupabaseSessionContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseSessionContext);

  if (!context) {
    throw new Error(
      "useSupabase must be used within a SupabaseSessionProvider.",
    );
  }

  return context;
}
