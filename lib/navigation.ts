import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";

export type AppRoute =
  | "/"
  | "/timeline"
  | "/vendors"
  | "/comms"
  | "/orchestrator"
  | "/budget";

export interface NavigationItem {
  href: AppRoute;
  icon: LucideIcon;
  label: string;
}

export const navigationItems: NavigationItem[] = [
  {
    href: "/",
    icon: LayoutDashboard,
    label: "Dashboard",
  },
  {
    href: "/timeline",
    icon: GitBranch,
    label: "Timeline",
  },
  {
    href: "/vendors",
    icon: Store,
    label: "Vendors",
  },
  {
    href: "/comms",
    icon: MessageSquare,
    label: "Communication Agent",
  },
  {
    href: "/orchestrator",
    icon: Sparkles,
    label: "AI Orchestrator",
  },
  {
    href: "/budget",
    icon: Wallet,
    label: "Budget & More",
  },
];

const pageTitles: Record<AppRoute, string> = {
  "/": "Dashboard",
  "/timeline": "Timeline",
  "/vendors": "Vendors",
  "/comms": "Communication Agent",
  "/orchestrator": "AI Orchestrator",
  "/budget": "Budget & More",
};

export function getPageTitle(pathname: string): string {
  if (pathname in pageTitles) {
    return pageTitles[pathname as AppRoute];
  }

  return "Wedly";
}
