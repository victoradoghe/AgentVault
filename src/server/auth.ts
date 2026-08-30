import "server-only";

import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { getAuthMode, LOCAL_SESSION_COOKIE } from "@/lib/auth-mode";
import { createClient } from "@/lib/supabase/server";
import { verifyLocalSessionToken } from "./localSession";

/**
 * Authentication for the web dashboard (Supabase session cookies).
 *
 * The REST API's API-key path lives in `apiKeys.ts`; the request-level resolver
 * that picks between the two is `src/lib/api/auth.ts`. This module owns only the
 * session -> local-user mapping.
 *
 * AgentVault keeps its own `User` row — projects and memories hang off it —
 * which has to be tied to whoever the auth provider says is signed in.
 *
 * ## Why not key on email
 *
 * Email is the obvious handle and the wrong one: it is mutable. A user who
 * changes their address in Supabase is the same person, but keyed on email they
 * come back as a brand-new account with none of their projects or memories, and
 * the old row is orphaned with no way to reach it. So the provider's own id
 * (Supabase's `sub`, immutable for the life of the account) is the key, and
 * email is demoted to a display field.
 *
 * Existing rows predate the column, so lookup falls back to email and adopts the
 * external id onto the row it finds. That backfill is what makes this migration
 * invisible to people who already have an account.
 */

/** The acting user as the rest of the app knows them. */
export interface LocalUser {
  id: string;
  email: string;
}

/** Who the auth provider says is signed in. */
interface SessionIdentity {
  email: string;
  /**
   * The provider's stable id for this account. Null in local dev auth mode,
   * which has no provider — there, email genuinely is the identity, because a
   * "login" is nothing more than a claimed address.
   */
  externalId: string | null;
}

/**
 * Resolve the current session to a provider identity, or null if not signed in.
 * Reads the local dev session cookie when Supabase isn't configured, otherwise
 * the Supabase session.
 */
async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const mode = getAuthMode();

  // No auth backend at all (see auth-mode.ts): nobody is signed in. Returning
  // null here — rather than falling through to Supabase with undefined
  // credentials — is what keeps the failure a clean "signed out" instead of a
  // crash on every request.
  if (mode === "unconfigured") return null;

  if (mode === "local") {
    const store = await cookies();
    const email = verifyLocalSessionToken(store.get(LOCAL_SESSION_COOKIE)?.value);
    return email ? { email, externalId: null } : null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;
  return { email: user.email, externalId: user.id };
}

/**
 * The current user's email, or null if not signed in.
 *
 * Session-only and cheap — no database round trip — which is what the pages that
 * merely need to redirect a signed-in visitor away from /login depend on.
 */
export async function getSessionEmail(): Promise<string | null> {
  return (await getSessionIdentity())?.email ?? null;
}

/**
 * Resolve the current session to a local `User`, creating it on first sight.
 * Returns null when there is no valid session — callers map that to a 401 or a
 * redirect. Never throws for the unauthenticated case.
 */
export async function getLocalUser(): Promise<LocalUser | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;

  const { email, externalId } = identity;

  // Local dev auth has no provider id, so email is all there is to key on. That
  // is not a weakness of this function: the mode itself takes any email with no
  // password (see auth-mode.ts), and it is refused in production.
  if (!externalId) {
    return prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
      select: { id: true, email: true },
    });
  }

  // 1. Known provider id — the authoritative case. The stored email is refreshed
  //    so a change in Supabase is reflected here rather than drifting.
  const byExternalId = await prisma.user.findUnique({
    where: { externalId },
    select: { id: true, email: true },
  });
  if (byExternalId) {
    if (byExternalId.email !== email) {
      return prisma.user.update({
        where: { id: byExternalId.id },
        data: { email },
        select: { id: true, email: true },
      });
    }
    return byExternalId;
  }

  // 2. No row for this provider id. Either the account is new, or it predates
  //    the column — adopt the row matching the email and stamp the id onto it.
  //    `updateMany` scopes the write to rows that have NOT already been claimed
  //    by a different provider id, so two Supabase accounts sharing an email can
  //    never take each other's data.
  const { count } = await prisma.user.updateMany({
    where: { email, externalId: null },
    data: { externalId },
  });
  if (count > 0) {
    return prisma.user.findUniqueOrThrow({
      where: { externalId },
      select: { id: true, email: true },
    });
  }

  // 3. Nothing to adopt: a genuinely new account.
  try {
    return await prisma.user.create({
      data: { email, externalId },
      select: { id: true, email: true },
    });
  } catch {
    // The email is taken by a row already claimed by a DIFFERENT provider id.
    // Two distinct auth accounts assert the same address, so there is no honest
    // answer about which one owns the data — treat the caller as signed out
    // rather than handing them somebody else's memories.
    return null;
  }
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
