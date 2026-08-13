import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabasePublicKey, supabaseUrl } from "./keys";

/**
 * Supabase client for the SERVER (Server Components, Route Handlers, Server
 * Actions). Reads/writes the auth session through Next's request cookies so the
 * user's session is kept fresh and available to server code.
 *
 * The public URL and anon key are safe on the server; row-level security and
 * our own ownership scoping (every service call is filtered by `userId`) do the
 * real access control. The service-role key is never used here.
 *
 * `cookies()` is request-scoped, so a fresh client is created per request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl()!,
    supabasePublicKey()!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a Server Component the cookie store is read-only; the middleware
          // is responsible for refreshing the session cookie, so swallowing the
          // write here is safe.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — ignore.
          }
        },
      },
    },
  );
}
