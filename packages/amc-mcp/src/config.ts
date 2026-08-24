/**
 * Runtime configuration, read from environment variables the user sets in
 * their agent config (Claude Code / Codex CLI / OpenCode / etc.).
 *
 *   AMC_API_KEY            (required) — the user's AgentVault API key.
 *   AMC_BASE_URL           (optional) — base URL of the AgentVault REST API.
 *                                       Defaults to a local server on port
 *                                       3000; set it to your own deployment.
 *   AMC_REQUEST_TIMEOUT_MS (optional) — per-request abort budget.
 *   AMC_CACHE_DIR          (optional) — where the offline cache and outbox
 *                                       live. Defaults to ~/.agentvault.
 *   AMC_OFFLINE            (optional) — set to 0/false/off to disable the
 *                                       offline cache and queue entirely.
 */

import { defaultCacheRoot } from "./store.js";

/**
 * Where to look for the AgentVault API when AMC_BASE_URL is not set.
 *
 * AgentVault is self-hosted: there is no shared deployment to point at, so the
 * default is the local server (`pnpm dev` / `pnpm start`) that a user running
 * from a checkout already has. Anyone hosting it elsewhere sets AMC_BASE_URL,
 * and the dashboard's "Connect your agent" page fills that in for them.
 *
 * A default naming some hosted URL would be worse than no default at all: every
 * tool call fails against a host the user does not control, and the error blames
 * the network rather than the missing setting.
 */
export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

/**
 * How long to wait for one API call before giving up.
 *
 * Saving a memory is the slow path: the server embeds the text (loading the
 * model can take ~20s on the first call) and then writes the row and its vector
 * inside one database transaction. A first save against a cold `next dev`
 * server, which also compiles the route on demand, was measured at ~54s.
 *
 * A timeout here does NOT cancel that server-side work — the memory still gets
 * written — so aborting early reports a false failure and invites the agent to
 * retry, creating duplicates. Waiting is strictly better than a premature abort,
 * so the budget covers a cold start with room to spare. An unreachable server
 * fails fast on connection refusal regardless, so this only bites when the
 * server really is just slow.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

export interface AmcConfig {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  /** Root directory for the offline read cache and write outbox. */
  cacheDir: string;
  /**
   * Whether to cache reads and queue writes when the API is unreachable.
   *
   * On by default: an agent that silently loses a saved memory to a dropped
   * connection is the failure this package exists to prevent. It can be turned
   * off for environments where nothing may touch the local disk.
   */
  offlineEnabled: boolean;
}

/**
 * Reads and validates configuration from the environment.
 *
 * Throws a clear, user-facing error if AMC_API_KEY is missing so the failure
 * is obvious in the agent's MCP logs rather than surfacing as a cryptic 401
 * on the first tool call.
 */
export function loadConfig(
  // Only the handful of keys below are read, so accept any string map rather
  // than the full ProcessEnv shape — that keeps callers (and tests) from having
  // to supply unrelated variables like NODE_ENV.
  env: Record<string, string | undefined> = process.env,
): AmcConfig {
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

  // A junk value falls back to the default rather than failing the whole server
  // over an optional tuning knob.
  const parsedTimeout = Number(env.AMC_REQUEST_TIMEOUT_MS);
  const requestTimeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_REQUEST_TIMEOUT_MS;

  const cacheDir = env.AMC_CACHE_DIR?.trim() || defaultCacheRoot();

  // Opt-out, not opt-in: only an explicit falsey word disables it, so a typo
  // leaves the safety net in place rather than quietly removing it.
  const offlineFlag = env.AMC_OFFLINE?.trim().toLowerCase();
  const offlineEnabled = !(
    offlineFlag === "0" ||
    offlineFlag === "false" ||
    offlineFlag === "off" ||
    offlineFlag === "no"
  );

  return { apiKey, baseUrl, requestTimeoutMs, cacheDir, offlineEnabled };
}
