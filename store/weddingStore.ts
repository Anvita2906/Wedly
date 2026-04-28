import type { User } from "@supabase/supabase-js";
import { create } from "zustand";

import type { WeddingProfile } from "@/lib/supabase/types";

interface WeddingStore {
  isOnboarded: boolean;
  planningStartDate: string | null;
  setPlanningStartDate: (planningStartDate: string | null) => void;
  setIsOnboarded: (isOnboarded: boolean) => void;
  setUser: (user: User | null) => void;
  setWeddingProfile: (weddingProfile: WeddingProfile | null) => void;
  user: User | null;
  weddingProfile: WeddingProfile | null;
}

export const useWeddingStore = create<WeddingStore>((set) => ({
  isOnboarded: false,
  planningStartDate: null,
  setPlanningStartDate: (planningStartDate) => set({ planningStartDate }),
  setIsOnboarded: (isOnboarded) => set({ isOnboarded }),
  setUser: (user) => set({ user }),
  setWeddingProfile: (weddingProfile) => set({ weddingProfile }),
  user: null,
  weddingProfile: null,
}));
