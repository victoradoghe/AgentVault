/**
 * Auth mode detection — shared by client, server, and the edge middleware.
 *
 * AgentVault resolves to exactly one of three modes:
 *
 *   - **supabase**     — real Supabase Auth. Used whenever the Supabase env
 *                        vars are set. The only mode fit for production.
 *   - **local**        — the dev stopgap, so the app is usable before a
 *                        Supabase project exists. A "login" just records an
 *                        email — NO PASSWORD CHECK — in a signed cookie
 *                        mirrored to localStorage.
 *   - **unconfigured** — Supabase is absent AND local auth isn't permitted
 *                        here. Nobody can sign in; every auth path fails closed.
 *
 * The third state exists because local mode is an authentication bypass by
 * design: anyone who can reach the app can claim any email and read that user's
 * memories. Deriving it purely from "Supabase vars are missing" meant a
 * production deploy that forgot one variable silently downgraded to
 * no-authentication instead of failing loudly. So in production local mode must
 * be opted into explicitly, and its absence closes the door rather than opening
 * it.
 *
 * Adding the Supabase env vars flips the whole app to Supabase with no code
 * change. This must stay dependency-free and import-safe on every runtime.
 */

/** The resolved authentication backend. */
export type AuthMode = "supabase" | "local" | "unconfigured";

/** True when a real Supabase project is configured (→ use Supabase auth). */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Supabase renamed the browser-safe key from "anon" to "publishable"; accept
  // either variable name so a newer project's key isn't silently ignored.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
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

/**
 * Whether the passwordless local stopgap may be used at all.
 *
 * Outside production it always may — that's the whole point of it. In
 * production it requires an explicit opt-in, because the alternative is a
 * public deployment where every visitor can impersonate every user.
 *
 * The flag is `NEXT_PUBLIC_` deliberately: it is not a secret, and the browser
 * has to agree with the server about which mode is active (the sign-in form
 * branches on it). A server-only name would be inlined as `undefined` in the
 * client bundle and the two would disagree.
 */
export function isLocalAuthPermitted(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH?.trim() === "true";
}

/** Resolve the active auth backend. */
export function getAuthMode(): AuthMode {
  if (isSupabaseConfigured()) return "supabase";
  return isLocalAuthPermitted() ? "local" : "unconfigured";
}

/** True when running on the local dev auth stopgap. */
export function isLocalAuthMode(): boolean {
  return getAuthMode() === "local";
}

/**
 * True when no auth backend is available, so sign-in is impossible. Callers
 * must treat this as "nobody is signed in", never as "let them through".
 */
export function isAuthUnconfigured(): boolean {
  return getAuthMode() === "unconfigured";
}

/**
 * Operator-facing explanation for {@link isAuthUnconfigured}. Shown on the
 * sign-in page, where the person hitting it is usually the one who deployed it.
 */
export const AUTH_UNCONFIGURED_MESSAGE =
  "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable Supabase Auth. (The " +
  "passwordless local mode is development-only; to run it in production " +
  "anyway — it lets anyone sign in as anyone — set " +
  "NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH=true and AMC_LOCAL_AUTH_SECRET.)";

/** Cookie the server reads to authenticate a local-mode session (signed). */
export const LOCAL_SESSION_COOKIE = "amc_local_session";

/** localStorage key the client uses to remember the local-mode identity. */
export const LOCAL_USER_STORAGE_KEY = "amc_local_user";
