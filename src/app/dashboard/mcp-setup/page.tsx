/**
 * /dashboard/mcp-setup
 *
 * Server wrapper: supplies the two facts the client cannot work out on its own —
 * where this AgentVault checkout lives on disk (needed because `amc-mcp` is not
 * published to npm, so agents must launch the built entrypoint by absolute
 * path), and whether the MCP package has actually been built yet.
 *
 * The base URL is deliberately NOT computed here: the browser knows the real
 * origin it reached us on (including a non-default port), so the client derives
 * it from `window.location.origin`.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { McpSetup } from "./mcp-setup-client";

export const dynamic = "force-dynamic";

export default function McpSetupPage() {
  const root = process.cwd();
  const entrypoint = path.join(root, "packages", "amc-mcp", "dist", "index.js");

  return (
    <McpSetup
      // Forward slashes work on every platform and avoid TOML/JSON escaping.
      entrypoint={entrypoint.replace(/\\/g, "/")}
      isBuilt={existsSync(entrypoint)}
    />
  );
}
