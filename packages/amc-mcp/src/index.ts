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
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // Fail fast with a clear message if AMC_API_KEY is missing.
  const config = loadConfig();

  const server = new McpServer({
    name: "amc-mcp",
    version: "0.1.0",
  });

  const client = new AmcClient(config);
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: never write to stdout — it carries the MCP JSON-RPC stream.
  // Diagnostics go to stderr only.
  console.error(`amc-mcp ready (base URL: ${config.baseUrl})`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`amc-mcp failed to start: ${message}`);
  process.exit(1);
});
