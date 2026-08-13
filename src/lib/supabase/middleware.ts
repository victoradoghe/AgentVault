import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabasePublicKey, supabaseUrl } from "./keys";

/**
 * Session refresh + route guard used by the root `src/middleware.ts`.
 *
 * Supabase access tokens are short-lived; this runs on every matched request,
 * refreshes the session cookie when needed, and — because the matcher only
 * covers `/dashboard` — redirects unauthenticated visitors to `/login`.
 *
 * IMPORTANT: this file runs on the Edge runtime, so it must not import Prisma
 * or anything Node-only. It only talks to Supabase Auth.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl()!,
    supabasePublicKey()!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser() — it revalidates
  // the token and is what keeps the session fresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The matcher already scopes this to protected routes, but guard explicitly so
  // the intent is local to this file.
  const isProtected = request.nextUrl.pathname.startsWith("/dashboard");
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
