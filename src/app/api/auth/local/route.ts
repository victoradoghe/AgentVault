import { z } from "zod";

import { created, errorResponse, handleError, noContent } from "@/lib/api/http";
import { isLocalAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
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
    if (!isLocalAuthMode()) {
      return errorResponse(404, "Local auth is disabled (Supabase is configured).");
    }

    const raw = await req.json().catch(() => ({}));
    const { email } = bodySchema.parse(raw);
    const token = createLocalSessionToken(email);

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
