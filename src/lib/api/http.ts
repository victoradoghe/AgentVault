import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { env } from "@/lib/env";
import { ServiceError } from "@/server/errors";

/**
 * HTTP helpers shared by every AgentVault REST route handler.
 *
 * Response envelopes are intentionally simple and match what the MCP client
 * (`packages/amc-mcp/src/client.ts`) unwraps: bare `{ <key>: ... }` objects for
 * success, `{ error: string }` for failures. Errors thrown by the service layer
 * (`ServiceError` subclasses) and Zod carry their own status, so `handleError`
 * turns "just throw" into the right HTTP response with no per-route boilerplate.
 */

/** 200 with a JSON body. */
export function ok(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}

/** 201 Created with a JSON body. */
export function created(body: unknown): NextResponse {
  return NextResponse.json(body, { status: 201 });
}

/** 204 No Content. */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** A JSON error envelope. */
export function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** 401 helper for unauthenticated requests. */
export function unauthorized(
  message = "Authentication required. Provide a Bearer API key or sign in.",
): NextResponse {
  return errorResponse(401, message);
}

/**
 * Map any thrown error to a response. Known typed errors keep their status and
 * message; validation errors become a readable 400; anything else is a 500 with
 * the details logged server-side but not leaked to the client.
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    return errorResponse(err.status, err.message);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".");
    const message = first
      ? `${path ? `${path}: ` : ""}${first.message}`
      : "Invalid request.";
    return errorResponse(400, message);
  }
  // No database configured yet: turn the inevitable connection failure into a
  // clear, actionable message instead of a scary 500. Auth still works without
  // a DB; projects/memories need one (local Postgres or Supabase).
  if (!env.DATABASE_URL) {
    return errorResponse(
      503,
      "Database not configured. Set DATABASE_URL and DIRECT_URL in .env " +
        "(or connect Supabase) to use projects and memories. Sign-in works without it.",
    );
  }
  console.error("[api] unhandled error:", err);
  return errorResponse(500, "Internal server error.");
}
