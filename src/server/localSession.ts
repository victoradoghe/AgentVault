import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed tokens for the local dev auth stopgap (see `src/lib/auth-mode.ts`).
 *
 * The token is `base64url(email).hmac` — HMAC-SHA256 over the payload with a
 * server secret. It proves the email was issued by this server (so a client
 * can't forge an arbitrary identity by editing a cookie) without needing any
 * session store. This is NOT a substitute for real auth: there's no password,
 * so it's for local development only, until Supabase is connected.
 *
 * Verification runs in the Node.js runtime (route handlers, server components);
 * the edge middleware only checks cookie presence, never calls in here.
 */

const SECRET =
  process.env.AMC_LOCAL_AUTH_SECRET?.trim() ||
  // Fixed dev fallback so sessions survive restarts without extra config.
  "amc-local-dev-auth-secret-change-me";

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Create a signed session token for an email. */
export function createLocalSessionToken(email: string): string {
  const payload = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify a token and return its email, or null if missing/tampered. */
export function verifyLocalSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
