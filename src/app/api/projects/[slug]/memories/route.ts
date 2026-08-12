import { getRequestAuth } from "@/lib/api/auth";
import { created, handleError, ok, unauthorized } from "@/lib/api/http";
import { memoryCategorySchema } from "@/lib/categories";
import { createMemory, listMemories } from "@/server/memories";
import { getProjectBySlug } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
