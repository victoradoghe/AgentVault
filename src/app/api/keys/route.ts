import { getRequestAuth } from "@/lib/api/auth";
import { created, errorResponse, handleError, ok, unauthorized } from "@/lib/api/http";
import { enforceRateLimit, GENERAL_RULE, KEY_MINTING_RULE } from "@/lib/api/rate-limit";
import { createApiKey, listApiKeys } from "@/server/apiKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Key management is deliberately SESSION-ONLY: an API key must not be able to
 * mint or list sibling keys. Reject anything authenticated by Bearer key.
 */
function requireSession(method: string): boolean {
  return method === "session";
}

/** GET /api/keys — list the signed-in user's API keys (metadata only). */
export async function GET(req: Request) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(GENERAL_RULE, auth.userId);
    if (limited) return limited;

    if (!requireSession(auth.method)) {
      return errorResponse(403, "API keys can only be managed from the dashboard.");
    }

    const keys = await listApiKeys(auth.userId);
    return ok({ keys });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/keys — mint a new key. Body: { label? }. The raw secret is returned
 * exactly once, in this response, and is unrecoverable afterward.
 */
export async function POST(req: Request) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(KEY_MINTING_RULE, auth.userId);
    if (limited) return limited;

    if (!requireSession(auth.method)) {
      return errorResponse(403, "API keys can only be managed from the dashboard.");
    }

    const body = await req.json().catch(() => ({}));
    const key = await createApiKey(auth.userId, body?.label);
    return created({ key });
  } catch (err) {
    return handleError(err);
  }
}
