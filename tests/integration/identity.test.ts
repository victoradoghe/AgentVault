import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** The Supabase user the mocked client will report for the next call. */
let sessionUser: { id: string; email: string } | null = null;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
  }),
}));

import { prisma } from "@/lib/prisma";
import { getLocalUser } from "@/server/auth";

/**
 * Identity resolution: which AgentVault `User` a Supabase session maps to.
 *
 * This is keyed on the provider's immutable id rather than the email address,
 * and the interesting cases are all about that distinction — a changed email
 * must not orphan an account, and a shared email must not merge two of them.
 *
 * Needs a database because the whole mechanism is a sequence of Prisma queries
 * against a unique index; there is nothing pure left to test in isolation.
 */

const created: string[] = [];

/** Track a resolved user so it can be cleaned up, and return it. */
async function resolve(): Promise<{ id: string; email: string } | null> {
  const user = await getLocalUser();
  if (user && !created.includes(user.id)) created.push(user.id);
  return user;
}

function newEmail(): string {
  return `identity-${randomUUID()}@agentvault.test`;
}

beforeAll(() => {
  // Force Supabase mode: local mode has no provider id and takes the other
  // branch entirely (it is covered by the last case below).
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example-project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

afterEach(() => {
  sessionUser = null;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.user.deleteMany({ where: { id: { in: created } } }).catch(() => {});
});

describe("a new Supabase account", () => {
  it("provisions a user carrying the provider id", async () => {
    const sub = randomUUID();
    const email = newEmail();
    sessionUser = { id: sub, email };

    const user = await resolve();
    expect(user).not.toBeNull();

    const row = await prisma.user.findUnique({
      where: { id: user!.id },
      select: { email: true, externalId: true },
    });
    expect(row).toEqual({ email, externalId: sub });
  });

  it("resolves to the same user on every later request", async () => {
    const sub = randomUUID();
    sessionUser = { id: sub, email: newEmail() };

    const first = await resolve();
    const second = await resolve();
    expect(second!.id).toBe(first!.id);
  });
});

describe("an email change in Supabase", () => {
  it("keeps the same account", async () => {
    // The whole reason this indirection exists. Keyed on email, the rename below
    // would silently hand the user an empty account and strand their memories.
    const sub = randomUUID();
    sessionUser = { id: sub, email: newEmail() };
    const before = await resolve();

    const renamed = newEmail();
    sessionUser = { id: sub, email: renamed };
    const after = await resolve();

    expect(after!.id).toBe(before!.id);
  });

  it("updates the stored email rather than letting it drift", async () => {
    const sub = randomUUID();
    sessionUser = { id: sub, email: newEmail() };
    await resolve();

    const renamed = newEmail();
    sessionUser = { id: sub, email: renamed };
    const after = await resolve();

    expect(after!.email).toBe(renamed);
  });

  it("frees the old address for someone else", async () => {
    const sub = randomUUID();
    const original = newEmail();
    sessionUser = { id: sub, email: original };
    const first = await resolve();

    sessionUser = { id: sub, email: newEmail() };
    await resolve();

    // A different person signing up with the now-released address is a new
    // account, not a way into the first one.
    sessionUser = { id: randomUUID(), email: original };
    const other = await resolve();

    expect(other).not.toBeNull();
    expect(other!.id).not.toBe(first!.id);
  });
});

describe("an account created before external ids existed", () => {
  it("is adopted by the matching Supabase session", async () => {
    // Exactly the shape of every row already in a deployed database: an email
    // and no external_id.
    const email = newEmail();
    const legacy = await prisma.user.create({
      data: { email },
      select: { id: true },
    });
    created.push(legacy.id);

    const sub = randomUUID();
    sessionUser = { id: sub, email };
    const resolved = await resolve();

    // Same row — the user keeps every project and memory they had.
    expect(resolved!.id).toBe(legacy.id);

    const row = await prisma.user.findUnique({
      where: { id: legacy.id },
      select: { externalId: true },
    });
    expect(row!.externalId).toBe(sub);
  });

  it("is adopted only once", async () => {
    const email = newEmail();
    const legacy = await prisma.user.create({ data: { email }, select: { id: true } });
    created.push(legacy.id);

    sessionUser = { id: randomUUID(), email };
    const firstClaimant = await resolve();
    expect(firstClaimant!.id).toBe(legacy.id);

    // A SECOND Supabase account asserting the same address must not be handed
    // the row the first one already claimed. There is no honest answer about who
    // owns the data, so the caller is treated as signed out.
    sessionUser = { id: randomUUID(), email };
    expect(await resolve()).toBeNull();
  });
});

describe("no session", () => {
  it("resolves to nobody", async () => {
    sessionUser = null;
    expect(await getLocalUser()).toBeNull();
  });

  it("resolves to nobody when the provider reports no email", async () => {
    // Supabase can return a user with no email (phone-only sign-ups). There is
    // nothing to key on, so this must not provision a half-formed account.
    sessionUser = { id: randomUUID(), email: "" };
    expect(await getLocalUser()).toBeNull();
  });
});
