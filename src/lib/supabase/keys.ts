/**
 * The Supabase public key, under either of its two supported variable names.
 *
 * Supabase renamed the browser-safe key from "anon" to "publishable"; projects
 * created since the change hand you `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
 * while older setups (and most tutorials) use `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * Accepting both means a copied-in value works whichever name it arrived under,
 * instead of silently leaving the app in local auth mode.
 *
 * Both names are referenced as static `process.env.X` member expressions so
 * Next.js inlines them into the browser bundle — a dynamic lookup would not be
 * replaced at build time and would come back undefined in the browser.
 *
 * Must stay dependency-free and import-safe on every runtime (browser, server,
 * and edge middleware).
 */
export function supabasePublicKey(): string | undefined {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return key || undefined;
}

/** The Supabase project URL. */
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}
