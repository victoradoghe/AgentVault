/**
 * Runtime configuration, read from environment variables the user sets in
 * their agent config (Claude Code / Codex CLI / OpenCode / etc.).
 *
 *   AMC_API_KEY   (required)  — the user's AgentVault API key.
 *   AMC_BASE_URL  (optional)  — base URL of the AgentVault REST API.
 *                               Defaults to the hosted deployment; override
 *                               with http://localhost:3000 for local dev.
 */

/** Default hosted AgentVault deployment. Override with AMC_BASE_URL for local dev. */
export const DEFAULT_BASE_URL = "https://agent-memory-cloud.vercel.app";

export interface AmcConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Reads and validates configuration from the environment.
 *
 * Throws a clear, user-facing error if AMC_API_KEY is missing so the failure
 * is obvious in the agent's MCP logs rather than surfacing as a cryptic 401
 * on the first tool call.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AmcConfig {
  const apiKey = env.AMC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "AMC_API_KEY is not set. Add it to your agent's MCP server config " +
        "(env: { AMC_API_KEY: \"amc_...\" }). You can create a key in the " +
        "AgentVault dashboard under Settings → API Keys.",
    );
  }

  const rawBase = env.AMC_BASE_URL?.trim() || DEFAULT_BASE_URL;
  // Normalise: strip any trailing slash so path joins are predictable.
  const baseUrl = rawBase.replace(/\/+$/, "");

  return { apiKey, baseUrl };
}
