import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { SupabaseSessionProvider } from "@/components/supabase-session-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Wedly",
    template: "%s | Wedly",
  },
  description: "Wedly is an AI-native wedding planning orchestrator.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({
  children,
}: Readonly<RootLayoutProps>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body
        suppressHydrationWarning
        className="h-screen overflow-hidden bg-cream font-sans text-ink antialiased"
      >
        <SupabaseSessionProvider
          initialSession={null}
          initialUser={null}
          initialWeddingProfile={null}
        >
          <AppShell>{children}</AppShell>
        </SupabaseSessionProvider>
      </body>
    </html>
  );
}
