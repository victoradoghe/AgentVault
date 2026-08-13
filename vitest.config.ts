import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Unit-test config for the AgentVault service layer.
 *
 * These tests cover the pure logic — context packing, the category taxonomy,
 * input validation, slugging, and session-token signing — so the whole suite
 * runs with no database, no network, and no embedding model. Anything that
 * needs live Postgres+pgvector is exercised by `pnpm verify` instead.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `server-only` is a Next.js guard module that throws if imported outside a
    // server context; under Vitest there is no such context, so stub it out.
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
  },
});
