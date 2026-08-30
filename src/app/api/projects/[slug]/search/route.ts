import { getRequestAuth } from "@/lib/api/auth";
import { handleError, ok, unauthorized } from "@/lib/api/http";
import { enforceRateLimit, EMBEDDING_RULE } from "@/lib/api/rate-limit";
import { getProjectBySlug } from "@/server/projects";
import { searchMemories } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * This route runs the embedding model. On a cold serverless container that
 * means fetching and loading ~90 MB before the first vector, which comfortably
 * exceeds the platform's default function timeout — so raise it here rather
 * than letting the first call after a deploy 504.
 */
export const maxDuration = 60;

/**
 * GET /api/projects/:slug/search?query=&limit= — semantic search over a
 * project's memories, ranked by cosine similarity. `limit` is optional
 * (defaults to 10, capped at 50 by the service schema).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(EMBEDDING_RULE, auth.userId);
    if (limited) return limited;

    const { slug } = await params;
    const url = new URL(req.url);
    const query = url.searchParams.get("query") ?? "";
    const limitParam = url.searchParams.get("limit");

    const project = await getProjectBySlug(auth.userId, slug);
    const results = await searchMemories({
      userId: auth.userId,
      projectId: project.id,
      query,
      // Leave undefined (→ schema default) when the caller didn't ask.
      limit: limitParam != null ? Number(limitParam) : undefined,
    });
    return ok({ results });
  } catch (err) {
    return handleError(err);
  }
}
