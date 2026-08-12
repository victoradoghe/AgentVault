import { getLocalUser } from "@/server/auth";
import { getUserIdFromApiKey } from "@/server/apiKeys";

/**
 * Request-level auth resolver for the REST API.
 *
 * A route can be reached two ways and both resolve to a single acting user id:
 *   - `Authorization: Bearer amc_...` — a CLI agent via `amc-mcp` (or curl).
 *   - a Supabase session cookie — the web dashboard calling its own API.
 *
 * API keys take precedence when present. The `method` lets endpoints that must
 * be session-only (e.g. minting new API keys) reject key-based callers.
 */

export type AuthMethod = "apiKey" | "session";

export interface RequestAuth {
  userId: string;
  method: AuthMethod;
}

/** Pull a Bearer token out of the Authorization header, if any. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Resolve the caller to `{ userId, method }`, or null if unauthenticated.
 * Never throws for the unauthenticated case — callers return 401 via
 * `unauthorized()`.
 */
export async function getRequestAuth(req: Request): Promise<RequestAuth | null> {
  const token = bearerToken(req);
  if (token) {
    const userId = await getUserIdFromApiKey(token);
    return userId ? { userId, method: "apiKey" } : null;
  }

  const user = await getLocalUser();
  return user ? { userId: user.id, method: "session" } : null;
}
