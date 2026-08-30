import { getRequestAuth } from "@/lib/api/auth";
import { errorResponse, handleError, noContent, unauthorized } from "@/lib/api/http";
import { enforceRateLimit, GENERAL_RULE } from "@/lib/api/rate-limit";
import { revokeApiKey } from "@/server/apiKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/keys/:id — revoke (hard-delete) a key. Session-only. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(GENERAL_RULE, auth.userId);
    if (limited) return limited;

    if (auth.method !== "session") {
      return errorResponse(403, "API keys can only be managed from the dashboard.");
    }

    const { id } = await params;
    await revokeApiKey(auth.userId, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
