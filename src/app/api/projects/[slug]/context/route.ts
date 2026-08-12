import { getRequestAuth } from "@/lib/api/auth";
import { handleError, ok, unauthorized } from "@/lib/api/http";
import { getProjectBySlug } from "@/server/projects";
import { getProjectContext } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:slug/context — the "load my memory" endpoint.
 *
 * Returns the project's context bundle. When the client asks for markdown
 * (`Accept: text/markdown`) we return the ready-to-inject markdown as the raw
 * body; otherwise the full structured `ProjectContext` JSON (which also carries
 * `markdown`). The MCP client accepts either shape.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const { slug } = await params;
    const project = await getProjectBySlug(auth.userId, slug);
    const context = await getProjectContext({ userId: auth.userId, projectId: project.id });

    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/markdown")) {
      return new Response(context.markdown, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }
    return ok(context);
  } catch (err) {
    return handleError(err);
  }
}
