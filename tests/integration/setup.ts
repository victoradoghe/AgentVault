import "dotenv/config";

import { afterAll, beforeAll } from "vitest";

import { prisma } from "@/lib/prisma";
import { warmupEmbeddings } from "@/server/embeddings";

import { applyPgVector } from "../../scripts/apply-pgvector";

/**
 * Shared setup for the integration suite.
 *
 * Fails loudly rather than skipping when there is no database: a security suite
 * that silently passes because it never ran is worse than no suite at all. CI
 * provides a pgvector container; locally `.env` already points at one.
 *
 * Vitest runs a setup file per TEST FILE, but the config pins the suite to a
 * single fork — so the schema check and the model load are memoised on the
 * module and every file after the first gets them for free. That matters more
 * than it looks: against a distant pooler each round trip costs seconds, and
 * re-running the DDL three times was enough to trip a connection timeout.
 */
let prepared: Promise<void> | undefined;

async function prepareOnce(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "Integration tests need DATABASE_URL. Start a Postgres with pgvector and " +
        "set it in .env, or run `pnpm test` for the unit suite only.",
    );
  }

  // Idempotent, and the reason a bare `pgvector/pgvector` container works in CI
  // with no separate schema step.
  await applyPgVector(prisma);

  // Load the model up front so the first test's timeout is not really a
  // model-download timeout.
  await warmupEmbeddings();
}

beforeAll(async () => {
  prepared ??= prepareOnce();
  await prepared;
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect().catch(() => {});
});
