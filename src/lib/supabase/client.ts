import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for the BROWSER (Client Components).
 *
 * Used by the login/register forms and the sign-out control. It reads the
 * public URL and anon key that Next inlines into the browser bundle
 * (`NEXT_PUBLIC_*`). The session it establishes is stored in cookies that the
 * server client and middleware can read.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
