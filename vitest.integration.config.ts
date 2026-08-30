import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Integration-test config: the suite that needs a real database.
 *
 * These tests prove the things the unit suite structurally cannot — above all
 * that one user can never reach another user's data. That property lives in
 * Prisma `where` clauses and raw SQL joins, so the only way to test it honestly
 * is against Postgres with pgvector, through the same service functions the API
 * calls.
 *
 * Requires DATABASE_URL. Every test namespaces its rows to throwaway users and
 * deletes them afterwards, so it is safe against a live database — but CI runs
 * it against a disposable pgvector container.
 *
 * Single-threaded and serial on purpose: the tests share one Prisma client and
 * one embedding model, and parallel workers would each load their own ~90 MB
 * copy of the model.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Model load + real embeddings make these far slower than a unit test.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    setupFiles: ["tests/integration/setup.ts"],
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
  },
});
