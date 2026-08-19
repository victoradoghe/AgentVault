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

/**
 * Fixed development secret, used so sessions survive a restart without extra
 * config. It is committed source, so anyone can mint a valid cookie for any
 * email with it — which is fine on a laptop and catastrophic on a public host.
 */
const DEV_FALLBACK_SECRET = "amc-local-dev-auth-secret-change-me";

/**
 * The signing secret, or null when there isn't one we're willing to use.
 *
 * In production the fallback is refused: someone who explicitly opted into
 * local mode (`NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH=true`) still must supply their
 * own secret, otherwise the "signature" proves nothing and the cookie is
 * forgeable by anyone who has read this file. Returning null makes both signing
 * and verification fail closed rather than accepting forgeries.
 */
function secret(): string | null {
  const configured = process.env.AMC_LOCAL_AUTH_SECRET?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : DEV_FALLBACK_SECRET;
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Create a signed session token for an email.
 *
 * @throws when no usable signing secret is configured — the caller (the local
 * sign-in route) turns that into a clear 500 rather than handing out a token
 * that anyone could have forged.
 */
export function createLocalSessionToken(email: string): string {
  const key = secret();
  if (!key) {
    throw new Error(
      "AMC_LOCAL_AUTH_SECRET must be set to use local auth mode in production.",
    );
  }
  const payload = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** Verify a token and return its email, or null if missing/tampered/unsigned. */
export function verifyLocalSessionToken(token: string | undefined): string | null {
  if (!token) return null;

  const key = secret();
  if (!key) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}
