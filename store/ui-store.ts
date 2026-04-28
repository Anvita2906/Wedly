import { create } from "zustand";

interface UiStore {
  closeMobileSidebar: () => void;
  isMobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  toggleMobileSidebar: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
  isMobileSidebarOpen: false,
  openMobileSidebar: () => set({ isMobileSidebarOpen: true }),
  toggleMobileSidebar: () =>
    set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
}));
