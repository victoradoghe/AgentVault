/** Server wrapper for the portable MCP setup screen. */
import { McpSetup } from "./mcp-setup-client";

export const dynamic = "force-dynamic";

export default function McpSetupPage() {
  // Allows npm scope/private registry names to be changed without a UI release.
  const packageName = process.env.MCP_PACKAGE_NAME?.trim() || "amc-mcp";
  return <McpSetup packageName={packageName} />;
}