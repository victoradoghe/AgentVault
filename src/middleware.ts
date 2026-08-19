import { NextResponse, type NextRequest } from "next/server";

import { getAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Root middleware. Keeps the session fresh and guards the dashboard.
 *
 * In Supabase mode it refreshes the Supabase session (`updateSession`). In local
 * dev mode it must NOT touch Supabase (no valid project) — it just checks the
 * signed session cookie is present. Full signature verification happens in the
 * Node runtime (server components / API routes); the edge only gates presence.
 *
 * When no auth backend is configured at all, everything is bounced to /login,
 * which explains what's missing. Falling through to `updateSession` instead
 * would construct a Supabase client from undefined credentials and throw on
 * every request.
 */
function toLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const mode = getAuthMode();
  const isProtected = request.nextUrl.pathname.startsWith("/dashboard");

  if (mode === "unconfigured") {
    return isProtected ? toLogin(request) : NextResponse.next();
  }

  if (mode === "local") {
    const hasSession = request.cookies.has(LOCAL_SESSION_COOKIE);
    if (!hasSession && isProtected) return toLogin(request);
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
