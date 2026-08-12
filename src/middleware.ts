import { NextResponse, type NextRequest } from "next/server";

import { isLocalAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Root middleware. Keeps the session fresh and guards the dashboard.
 *
 * In Supabase mode it refreshes the Supabase session (`updateSession`). In local
 * dev mode it must NOT touch Supabase (no valid project) — it just checks the
 * signed session cookie is present. Full signature verification happens in the
 * Node runtime (server components / API routes); the edge only gates presence.
 */
export async function middleware(request: NextRequest) {
  if (isLocalAuthMode()) {
    const hasSession = request.cookies.has(LOCAL_SESSION_COOKIE);
    if (!hasSession && request.nextUrl.pathname.startsWith("/dashboard")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
