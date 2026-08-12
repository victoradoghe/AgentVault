import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * Connection strings moved out of `schema.prisma` in v7 and live here. The app
 * runtime connects through the `@prisma/adapter-pg` driver adapter (see
 * `src/lib/prisma.ts`); this config is used by the Prisma CLI for
 * `migrate` / `db push` / `studio`.
 *
 * Supabase requires two URLs:
 *   - DATABASE_URL: pooled (pgBouncer) connection for the app at runtime
 *   - DIRECT_URL:   direct connection used for schema migrations
 *
 * `import "dotenv/config"` loads `.env` for the CLI — Prisma 7 no longer does
 * this automatically. Next.js loads `.env` on its own for the app runtime.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations must use the DIRECT (non-pooled) connection: Supabase's pooled
    // pgBouncer endpoint can't run the DDL/advisory locks Prisma Migrate needs.
    // Fall back to the pooled URL when only one is configured (e.g. local pg).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
