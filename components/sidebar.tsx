"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigationItems } from "@/lib/navigation";
import { useUiStore } from "@/store/ui-store";

interface SidebarProps {
  mobile?: boolean;
}

export function Sidebar({ mobile = false }: SidebarProps) {
  const pathname = usePathname();
  const closeMobileSidebar = useUiStore((state) => state.closeMobileSidebar);

  return (
    <aside
      className={`w-[260px] bg-sidebar ${
        mobile
          ? "flex h-full shadow-2xl"
          : "fixed inset-y-0 left-0 z-20 hidden h-screen border-r border-white/5 md:flex"
      }`}
    >
      <div className="flex h-full w-full flex-col px-4 py-5">
        <div className="pb-8">
          <Link
            className="inline-flex flex-col gap-1"
            href="/"
            onClick={closeMobileSidebar}
          >
            <span className="font-display text-[22px] leading-none text-white">
              Wed<span className="text-gold">ly</span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-gold/70">
              AI Orchestrator
            </span>
          </Link>
        </div>

        <nav className="flex-1">
          <ul className="space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    className="sidebar-link"
                    data-active={isActive}
                    href={item.href}
                    onClick={closeMobileSidebar}
                  >
                    <div className="sidebar-link-main">
                      <Icon className="sidebar-link-icon" strokeWidth={1.8} />
                      <span className="sidebar-link-label">{item.label}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
