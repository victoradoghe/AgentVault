import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

/**
 * Singleton Prisma client.
 *
 * Prisma 7 has no bundled query engine — the client talks to Postgres through a
 * driver adapter. We use `@prisma/adapter-pg` against the pooled DATABASE_URL
 * (Supabase pgBouncer); migrations use DIRECT_URL via `prisma.config.ts`.
 *
 * In development Next.js clears the module cache on every hot reload, which
 * would otherwise spin up a new client (and connection pool) each time. We cache
 * the instance on `globalThis` to reuse a single client across reloads.
 */
// Placeholder used only when DATABASE_URL is not configured yet. The client
// still constructs (connection is lazy), so the app boots and local auth works;
// any actual query fails with a connection error rather than crashing at import.
const UNCONFIGURED_DB_URL =
  "postgresql://user:password@localhost:5432/amc_unconfigured";

if (!env.DATABASE_URL) {
  console.warn(
    "[amc] DATABASE_URL is not set — database features (projects, memories) " +
      "will fail until you configure it. Local auth and the dashboard shell " +
      "still work. Set DATABASE_URL/DIRECT_URL in .env (Supabase or local Postgres).",
  );
}

/**
 * Interactive-transaction budgets.
 *
 * Prisma defaults to maxWait 2s / timeout 5s, which assume the database is
 * nearby. Against a Supabase pooler in another region those are too tight to
 * even get started: acquiring a connection means a fresh TLS handshake, and a
 * single round trip can cost seconds, so `$transaction` fails with
 * `P2028 Unable to start a transaction in the given time` before it has run any
 * statement at all. Every write path is a transaction (`createMemory` inserts
 * the row and its embedding vector together), so the tight defaults take out
 * memory writes entirely on a slow link.
 *
 * These are deliberately generous rather than tuned: they exist so latency
 * causes slowness instead of failure. Set the env vars to tighten them when the
 * database is local.
 */
const TRANSACTION_MAX_WAIT_MS = env.AMC_DB_TRANSACTION_MAX_WAIT_MS ?? 20_000;
const TRANSACTION_TIMEOUT_MS = env.AMC_DB_TRANSACTION_TIMEOUT_MS ?? 60_000;

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL ?? UNCONFIGURED_DB_URL,
      // Without this, a black-holed host leaves connection attempts hanging
      // forever; this turns that into a reportable error instead.
      connectionTimeoutMillis: 60_000,
    }),
    transactionOptions: {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
