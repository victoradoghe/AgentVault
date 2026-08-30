import { getRequestAuth } from "@/lib/api/auth";
import { created, handleError, ok, unauthorized } from "@/lib/api/http";
import { enforceRateLimit, GENERAL_RULE } from "@/lib/api/rate-limit";
import { createProject, listProjects } from "@/server/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/projects — list the caller's projects. */
export async function GET(req: Request) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(GENERAL_RULE, auth.userId);
    if (limited) return limited;

    const projects = await listProjects(auth.userId);
    return ok({ projects });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/projects — create a project. Body: { name }. */
export async function POST(req: Request) {
  try {
    const auth = await getRequestAuth(req);
    if (!auth) return unauthorized();

    const limited = enforceRateLimit(GENERAL_RULE, auth.userId);
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const project = await createProject({ userId: auth.userId, name: body?.name });
    return created({ project });
  } catch (err) {
    return handleError(err);
  }
}
