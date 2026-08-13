import "server-only";

import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { isLocalAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
import { createClient } from "@/lib/supabase/server";
import { verifyLocalSessionToken } from "./localSession";

/**
 * Authentication for the web dashboard (Supabase session cookies).
 *
 * The REST API's API-key path lives in `apiKeys.ts`; the request-level resolver
 * that picks between the two is `src/lib/api/auth.ts`. This module owns only the
 * session → local-user mapping.
 *
 * AgentVault keeps its own `User` row (projects/memories hang off it) keyed by the
 * email of the Supabase auth user. We upsert that row on demand so a user's
 * first authenticated action transparently provisions their local account.
 */

/** The acting user as the rest of the app knows them. */
export interface LocalUser {
  id: string;
  email: string;
}

/**
 * The current user's email, or null if not signed in. Reads the local dev
 * session cookie when Supabase isn't configured, otherwise the Supabase session.
 */
export async function getSessionEmail(): Promise<string | null> {
  if (isLocalAuthMode()) {
    const store = await cookies();
    return verifyLocalSessionToken(store.get(LOCAL_SESSION_COOKIE)?.value);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

/**
 * Resolve the current session to a local `User`, creating it on first sight.
 * Returns null when there is no valid session — callers map that to a 401 /
 * redirect. Never throws for the unauthenticated case.
 */
export async function getLocalUser(): Promise<LocalUser | null> {
  const email = await getSessionEmail();
  if (!email) return null;

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true, email: true },
  });
  return user;
}

/**
 * Like {@link getLocalUser} but throws when unauthenticated. For server code
 * that has already established the caller must be signed in.
 */
export async function requireLocalUser(): Promise<LocalUser> {
  const user = await getLocalUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}
