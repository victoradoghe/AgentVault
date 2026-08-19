/**
 * Post-authentication redirect targets.
 *
 * The `?next=` parameter is attacker-controllable (the middleware puts it there,
 * but anyone can craft a link), so it is never trusted verbatim: an absolute URL
 * would turn the sign-in page into an open redirect that bounces users to
 * another origin while looking like it came from us.
 */

/** Where a signed-in user goes when no specific destination was requested. */
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * Coerce a `?next=` value into a safe same-origin path, falling back to the
 * dashboard. Only root-relative paths survive:
 *   - `//evil.com` and `/\evil.com` are protocol-relative and would leave the
 *     origin, so they are rejected along with anything containing a backslash
 *     (browsers normalise `\` to `/` in URLs).
 *   - anything with a scheme (`https:`, `javascript:`) is rejected.
 */
export function resolveNextPath(next?: string | null): string {
  if (!next) return DEFAULT_SIGNED_IN_PATH;

  const value = next.trim();
  if (!value.startsWith("/")) return DEFAULT_SIGNED_IN_PATH;
  if (value.startsWith("//")) return DEFAULT_SIGNED_IN_PATH;
  if (value.includes("\\")) return DEFAULT_SIGNED_IN_PATH;

  return value;
}
