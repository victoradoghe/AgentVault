import { getRequestAuth } from "@/lib/api/auth";
import { handleError, noContent, unauthorized } from "@/lib/api/http";
import { deleteProject, getProjectBySlug } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/projects/:slug — delete a project and all its memories. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const { slug } = await params;
    const project = await getProjectBySlug(auth.userId, slug);
    await deleteProject(auth.userId, project.id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
