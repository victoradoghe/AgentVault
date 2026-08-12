import { getRequestAuth } from "@/lib/api/auth";
import { handleError, noContent, ok, unauthorized } from "@/lib/api/http";
import { deleteMemory, getMemory, updateMemory } from "@/server/memories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/memories/:id — fetch a single memory the caller owns. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const { id } = await params;
    const memory = await getMemory(auth.userId, id);
    return ok({ memory });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * PATCH /api/memories/:id — partial update. Body may include any of
 * { title, content, category, importance }; at least one is required.
 * Re-embeds when title/content change (handled by the service layer).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const memory = await updateMemory({
      userId: auth.userId,
      memoryId: id,
      title: body?.title,
      content: body?.content,
      category: body?.category,
      importance: body?.importance,
    });
    return ok({ memory });
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /api/memories/:id — permanently delete a memory the caller owns. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const { id } = await params;
    await deleteMemory(auth.userId, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
