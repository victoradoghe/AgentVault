import { getRequestAuth } from "@/lib/api/auth";
import { created, handleError, ok, unauthorized } from "@/lib/api/http";
import { enforceRateLimit, EMBEDDING_RULE, GENERAL_RULE } from "@/lib/api/rate-limit";
import { memoryCategorySchema } from "@/lib/categories";
import { createMemory, listMemories } from "@/server/memories";
import { getProjectBySlug } from "@/server/projects";

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
 * GET /api/projects/:slug/memories?category= — list a project's memories,
 * optionally filtered by category, most important & recent first.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(GENERAL_RULE, auth.userId);
    if (limited) return limited;

    const { slug } = await params;
    const url = new URL(req.url);
    const rawCategory = url.searchParams.get("category");
    // Validate the filter here so a bad value is a clean 400, not ignored.
    const category = rawCategory ? memoryCategorySchema.parse(rawCategory) : undefined;

    const project = await getProjectBySlug(auth.userId, slug);
    const memories = await listMemories({ userId: auth.userId, projectId: project.id, category });
    return ok({ memories });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/projects/:slug/memories — create a memory.
 * Body: { title, content, category?, importance? }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(EMBEDDING_RULE, auth.userId);
    if (limited) return limited;

    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const project = await getProjectBySlug(auth.userId, slug);

    const memory = await createMemory({
      userId: auth.userId,
      projectId: project.id,
      title: body?.title,
      content: body?.content,
      category: body?.category,
      importance: body?.importance,
    });
    return created({ memory });
  } catch (err) {
    return handleError(err);
  }
}
