import { z } from "zod";

import { created, errorResponse, handleError, noContent } from "@/lib/api/http";
import { AUTH_RULE, clientIp, enforceRateLimit } from "@/lib/api/rate-limit";
import {
  isLocalAuthMode,
  isSupabaseConfigured,
  LOCAL_SESSION_COOKIE,
} from "@/lib/auth-mode";
import { createLocalSessionToken } from "@/server/localSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local dev auth (see `src/lib/auth-mode.ts`). Only active when Supabase is NOT
 * configured; otherwise these endpoints 404 so the real auth path is used.
 *
 *   POST   /api/auth/local  { email }  → sets a signed session cookie.
 *   DELETE /api/auth/local             → clears it (sign out).
 *
 * There is no password: this exists so the app is usable before Supabase is
 * connected. The signed cookie is what the server authenticates on; the client
 * also mirrors the email to localStorage.
 */

const bodySchema = z.object({ email: z.email("Enter a valid email address.") });

/** Thirty days, in seconds. */
const MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: Request) {
  try {
    // Keyed by IP, and checked before anything else: this is the one endpoint
    // that hands out a session with no password, so the cost of guessing at it
    // must not be free. Every other route keys its limit on the authenticated
    // user, which is why this is the only caller of `clientIp`.
    const limited = enforceRateLimit(AUTH_RULE, `ip:${clientIp(req)}`);
    if (limited) return limited;

    if (!isLocalAuthMode()) {
      // Either Supabase is configured (use it), or local mode isn't permitted
      // here — in production it must be opted into explicitly. Both mean this
      // passwordless endpoint must not mint a session.
      return errorResponse(
        404,
        isSupabaseConfigured()
          ? "Local auth is disabled (Supabase is configured)."
          : "Local auth is disabled in production. " +
              "Configure Supabase auth, or set NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH=true " +
              "to allow passwordless sign-in anyway.",
      );
    }

    const raw = await req.json().catch(() => ({}));
    const { email } = bodySchema.parse(raw);

    // Throws when local mode is enabled in production without its own signing
    // secret. That is a deployment mistake, not a user error, so say so plainly
    // instead of letting it become a generic 500.
    let token: string;
    try {
      token = createLocalSessionToken(email);
    } catch {
      return errorResponse(
        500,
        "Local auth is enabled but AMC_LOCAL_AUTH_SECRET is not set. " +
          "Set it, or configure Supabase auth instead.",
      );
    }

    const res = created({ user: { email: email.trim().toLowerCase() } });
    res.cookies.set(LOCAL_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  const res = noContent();
  res.cookies.set(LOCAL_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
