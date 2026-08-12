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

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL ?? UNCONFIGURED_DB_URL,
    }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
