import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Unit-test config for the AgentVault service layer.
 *
 * These tests cover the pure logic — context packing, the category taxonomy,
 * input validation, slugging, rate limiting, and session-token signing — so the
 * whole suite runs with no database, no network, and no embedding model. It is
 * the suite that must stay fast enough to run on every keystroke.
 *
 * Anything needing live Postgres+pgvector lives in `tests/integration/` and is
 * run by `pnpm test:integration` (see vitest.integration.config.ts). It is
 * excluded here rather than merely skipped so `pnpm test` never depends on a
 * database being reachable.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
    // `server-only` is a Next.js guard module that throws if imported outside a
    // server context; under Vitest there is no such context, so stub it out.
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
  },
});
