import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createApiKey,
  getUserIdFromApiKey,
  listApiKeys,
  revokeApiKey,
} from "@/server/apiKeys";
import { NotFoundError } from "@/server/errors";

import { createTestUser, destroyTestUser, type TestUser } from "./helpers";

/**
 * API-key lifecycle.
 *
 * A key is the only credential an agent ever holds, and it is a bearer token
 * with no expiry — so the guarantees worth testing are that it is stored as a
 * hash and never recoverable, that revoking one actually stops it working, and
 * that one user cannot revoke another's.
 *
 * This needs a database because all of it lives in Prisma queries: the unit
 * suite can prove nothing about a unique-index lookup or a `deleteMany` scope.
 */

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("keys-alice");
  bob = await createTestUser("keys-bob");
});

afterAll(async () => {
  await destroyTestUser(alice);
  await destroyTestUser(bob);
});

describe("minting", () => {
  it("returns a prefixed secret", async () => {
    const key = await createApiKey(alice.id, "test key");
    expect(key.key).toMatch(/^amc_[A-Za-z0-9_-]{43}$/);
  });

  it("never stores the raw secret", async () => {
    const key = await createApiKey(alice.id, "storage check");
    const rows = await prisma.apiKey.findMany({
      where: { userId: alice.id },
      select: { keyHash: true },
    });
    // The whole point of hashing: a database dump must not yield working keys.
    expect(rows.every((r) => r.keyHash !== key.key)).toBe(true);
    expect(rows.some((r) => r.keyHash === key.key.slice(4))).toBe(false);
  });

  it("issues a different secret every time", async () => {
    const a = await createApiKey(alice.id);
    const b = await createApiKey(alice.id);
    expect(a.key).not.toBe(b.key);
  });
});

describe("resolution", () => {
  it("resolves a key to its owner", async () => {
    const key = await createApiKey(alice.id, "resolve");
    expect(await getUserIdFromApiKey(key.key)).toBe(alice.id);
  });

  it("resolves each user's key to that user", async () => {
    const aliceKey = await createApiKey(alice.id);
    const bobKey = await createApiKey(bob.id);
    expect(await getUserIdFromApiKey(aliceKey.key)).toBe(alice.id);
    expect(await getUserIdFromApiKey(bobKey.key)).toBe(bob.id);
  });

  it("rejects a key with the wrong prefix", async () => {
    const key = await createApiKey(alice.id);
    expect(await getUserIdFromApiKey(key.key.replace("amc_", "xyz_"))).toBeNull();
  });

  it("rejects an unknown key", async () => {
    expect(await getUserIdFromApiKey("amc_" + "a".repeat(43))).toBeNull();
  });

  it("rejects an empty or malformed token", async () => {
    expect(await getUserIdFromApiKey("")).toBeNull();
    expect(await getUserIdFromApiKey("Bearer amc_nope")).toBeNull();
  });

  it("tolerates surrounding whitespace", async () => {
    // Copy-paste out of a terminal routinely brings a trailing newline along.
    const key = await createApiKey(alice.id);
    expect(await getUserIdFromApiKey(`  ${key.key}\n`)).toBe(alice.id);
  });

  it("records when a key was last used", async () => {
    const key = await createApiKey(alice.id, "last-used");
    expect(await getUserIdFromApiKey(key.key)).toBe(alice.id);

    // The bump is fire-and-forget so auth is never blocked on it; give it a
    // moment to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const record = await prisma.apiKey.findUnique({
      where: { id: key.id },
      select: { lastUsedAt: true },
    });
    expect(record?.lastUsedAt).not.toBeNull();
  });
});

describe("listing", () => {
  it("never exposes the secret", async () => {
    const key = await createApiKey(alice.id, "listing");
    const listed = await listApiKeys(alice.id);
    const serialised = JSON.stringify(listed);
    expect(serialised).not.toContain(key.key);
    expect(serialised).not.toContain(key.key.slice(4));
  });

  it("shows a masked hint instead", async () => {
    await createApiKey(alice.id, "masked");
    const listed = await listApiKeys(alice.id);
    expect(listed[0].maskedKey).toMatch(/^amc_…[0-9a-f]{4}$/);
  });

  it("lists only the caller's own keys", async () => {
    const bobKey = await createApiKey(bob.id, "bob only");
    const listed = await listApiKeys(alice.id);
    expect(listed.map((k) => k.id)).not.toContain(bobKey.id);
  });
});

describe("revocation", () => {
  it("stops the key working", async () => {
    const key = await createApiKey(alice.id, "to revoke");
    expect(await getUserIdFromApiKey(key.key)).toBe(alice.id);

    await revokeApiKey(alice.id, key.id);
    expect(await getUserIdFromApiKey(key.key)).toBeNull();
  });

  it("refuses to revoke another user's key", async () => {
    // A 404, not a 403 — Bob must not learn that this key id exists.
    const key = await createApiKey(alice.id, "not bobs");
    await expect(revokeApiKey(bob.id, key.id)).rejects.toThrow(NotFoundError);

    // And it must still work afterwards.
    expect(await getUserIdFromApiKey(key.key)).toBe(alice.id);
  });

  it("refuses to revoke an unknown key", async () => {
    await expect(revokeApiKey(alice.id, crypto.randomUUID())).rejects.toThrow(
      NotFoundError,
    );
  });

  it("leaves the user's other keys working", async () => {
    const doomed = await createApiKey(alice.id, "doomed");
    const survivor = await createApiKey(alice.id, "survivor");

    await revokeApiKey(alice.id, doomed.id);

    expect(await getUserIdFromApiKey(doomed.key)).toBeNull();
    expect(await getUserIdFromApiKey(survivor.key)).toBe(alice.id);
  });
});
