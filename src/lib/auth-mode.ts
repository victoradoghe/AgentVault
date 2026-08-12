/**
 * Auth mode detection — shared by client, server, and the edge middleware.
 *
 * Agent Memory Cloud supports two auth backends:
 *
 *   - **Supabase** (production): used whenever the Supabase env vars are set.
 *   - **Local dev** (stopgap): used automatically when they are NOT set, so the
 *     app is fully usable before a Supabase project exists. A "login" just
 *     records an email — no password check — in a signed cookie (for the server)
 *     mirrored to localStorage (for the client).
 *
 * Adding the Supabase env vars flips the whole app to Supabase with no code
 * change. This must stay dependency-free and import-safe on every runtime.
 */

/** True when a real Supabase project is configured (→ use Supabase auth). */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  // Ignore the shipped placeholder so a copied .env.example stays in local mode.
  if (url.includes("your-project-ref")) return false;
  // A junk/invalid URL means "not really configured" → stay in local mode
  // rather than trying (and failing) to talk to Supabase.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return true;
}

/** Convenience inverse: true when running on the local dev auth stopgap. */
export function isLocalAuthMode(): boolean {
  return !isSupabaseConfigured();
}

/** Cookie the server reads to authenticate a local-mode session (signed). */
export const LOCAL_SESSION_COOKIE = "amc_local_session";

/** localStorage key the client uses to remember the local-mode identity. */
export const LOCAL_USER_STORAGE_KEY = "amc_local_user";
