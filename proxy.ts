import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

const GUEST_ROUTES = new Set(["/landing", "/login", "/signup"]);
const PROTECTED_ROUTE_PREFIXES = [
  "/budget",
  "/comms",
  "/orchestrator",
  "/timeline",
  "/vendors",
];

function isProtectedRoute(pathname: string) {
  return (
    pathname === "/" ||
    PROTECTED_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function isOnboardingRoute(pathname: string) {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

function redirectTo(pathname: string, request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    if (isProtectedRoute(pathname) || isOnboardingRoute(pathname)) {
      return redirectTo("/login", request);
    }

    return response;
  }

  if (GUEST_ROUTES.has(pathname) || isOnboardingRoute(pathname)) {
    const { data: weddingProfile } = await supabase
      .from("wedding_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (GUEST_ROUTES.has(pathname)) {
      return redirectTo(weddingProfile ? "/" : "/onboarding", request);
    }

    if (isOnboardingRoute(pathname) && weddingProfile) {
      return redirectTo("/", request);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*$).*)"],
};
