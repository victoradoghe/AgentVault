#!/usr/bin/env node
/**
 * amc-mcp — AgentVault MCP server (stdio).
 *
 * Runs as a stdio MCP server so coding agents (Claude Code, Codex CLI,
 * OpenCode, …) can load and save project-scoped memory. It is a thin client of
 * the AgentVault REST API; configuration comes entirely from environment variables:
 *
 *   AMC_API_KEY   (required)  — your AgentVault API key (amc_...).
 *   AMC_BASE_URL  (optional)  — override the API base URL (local dev).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { AmcClient } from "./client.js";
import { OfflineClient } from "./offline.js";
import { OfflineStore, namespaceFor } from "./store.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // Fail fast with a clear message if AMC_API_KEY is missing.
  const config = loadConfig();

  const server = new McpServer({
    name: "amc-mcp",
    version: "0.1.0",
  });

  const store = new OfflineStore(
    config.cacheDir,
    namespaceFor(config.baseUrl, config.apiKey),
  );
  const client = new OfflineClient(
    new AmcClient(config),
    store,
    config.offlineEnabled,
  );
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: never write to stdout — it carries the MCP JSON-RPC stream.
  // Diagnostics go to stderr only.
  const pending = client.pendingCount();
  console.error(
    `amc-mcp ready (base URL: ${config.baseUrl}` +
      (config.offlineEnabled ? `, offline cache: ${config.cacheDir}` : ", offline cache: off") +
      `)` +
      (pending > 0 ? `\namc-mcp: ${pending} write(s) queued offline, will sync on first call.` : ""),
  );

  // Drain anything left over from a previous offline session without waiting
  // for the agent's first tool call. A failure here just means still offline.
  void client.flush().catch(() => {});
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`amc-mcp failed to start: ${message}`);
  process.exit(1);
});
