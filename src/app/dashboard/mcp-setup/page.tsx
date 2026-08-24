/**
 * /dashboard/mcp-setup
 *
 * Server wrapper: supplies the facts the browser cannot work out on its own —
 * how the `amc-mcp` server should be launched, and whether that launch will
 * actually work right now.
 *
 * There are two launch shapes, and the page must never offer the wrong one:
 *
 *   - **A published package.** Set `MCP_PACKAGE_NAME` once the package is on a
 *     registry the user's machine can reach, and the page hands out
 *     `npx -y <name>@latest`, which works from anywhere.
 *   - **This checkout.** The default. `amc-mcp` is not published, so agents
 *     launch the built entrypoint by absolute path — and the page says so, and
 *     says when it hasn't been built yet, rather than printing a command that
 *     404s.
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
  // Lets a scoped or private-registry name be swapped in without a UI release.
  const packageName = process.env.MCP_PACKAGE_NAME?.trim() || null;
  const entrypoint = path.join(process.cwd(), "packages", "amc-mcp", "dist", "index.js");

  return (
    <McpSetup
      packageName={packageName}
      // Forward slashes work on every platform and avoid TOML/JSON escaping.
      entrypoint={entrypoint.replace(/\\/g, "/")}
      isBuilt={existsSync(entrypoint)}
    />
  );
}
