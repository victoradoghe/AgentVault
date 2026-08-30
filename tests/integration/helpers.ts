import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { createApiKey } from "@/server/apiKeys";

/**
 * Fixtures for the integration suite.
 *
 * Every row these create hangs off a throwaway `User`, and deleting that user
 * cascades to their projects, memories, and API keys. That is what makes the
 * suite safe to point at a real database: it can only ever remove what it made.
 */

/** A test user plus a live API key for driving the HTTP layer as them. */
export interface TestUser {
  id: string;
  email: string;
  apiKey: string;
}

/** Emails are namespaced so a failed run's leftovers are obvious and greppable. */
export async function createTestUser(name: string): Promise<TestUser> {
  const email = `it-${name}-${randomUUID()}@agentvault.test`;
  const user = await prisma.user.create({ data: { email }, select: { id: true } });
  const key = await createApiKey(user.id, `${name} integration key`);
  return { id: user.id, email, apiKey: key.key };
}

/**
 * Delete a test user and everything that cascades from them.
 *
 * `deleteMany`, not `delete`: `delete` returns the deleted row, so it SELECTs
 * every column of `users` — and fails outright against a database missing one
 * (exactly what happens when a migration has not been applied yet). `deleteMany`
 * returns a count and touches no columns.
 *
 * A cleanup failure is reported rather than swallowed. Swallowing it silently is
 * how a run leaves orphaned users behind in a real database and nobody notices.
 */
export async function destroyTestUser(user: TestUser | undefined): Promise<void> {
  if (!user) return;
  try {
    await prisma.user.deleteMany({ where: { id: user.id } });
  } catch (err) {
    console.error(
      `[integration] FAILED to clean up test user ${user.email} (${user.id}) — ` +
        `delete it by hand. Cause:`,
      err,
    );
  }
}

/** A UUID that is well-formed but belongs to nothing — for "not found" cases. */
export function unknownUuid(): string {
  return randomUUID();
}
