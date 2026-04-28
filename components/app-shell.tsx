"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { useUiStore } from "@/store/ui-store";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isMobileSidebarOpen = useUiStore((state) => state.isMobileSidebarOpen);
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);
  const isFramelessRoute =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/landing" ||
    pathname.startsWith("/onboarding");

  useEffect(() => {
    closeMobileSidebar();
  }, [pathname, closeMobileSidebar]);

  if (isFramelessRoute) {
    return <main className="min-h-screen bg-cream">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-cream">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col md:pl-[260px]">
        <TopBar />

        <main className="min-h-0 flex-1 overflow-y-auto bg-cream p-7">
          {children}
        </main>
      </div>

      <button
        aria-label="Close navigation menu"
        className={`fixed inset-0 z-40 bg-ink/60 transition-opacity duration-150 ease-in-out md:hidden ${
          isMobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={closeMobileSidebar}
        type="button"
      />

      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-150 ease-in-out md:hidden ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar mobile />
      </div>
    </div>
  );
}
