/**
 * Typed errors for the service layer.
 *
 * Services throw these instead of returning null/undefined so the callers
 * (the REST API and the MCP server) can map them onto HTTP status codes
 * without knowing anything about Prisma or the internals here.
 *
 * Ownership is enforced by scoping every query to the acting `userId`. When a
 * row that doesn't belong to the user is requested we surface `NotFoundError`
 * (a 404) rather than a 403 — that way we never leak whether another user's
 * resource exists.
 */

export type ServiceErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;

  constructor(message: string, code: ServiceErrorCode, status: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

/** A resource does not exist — or exists but is not owned by the caller. */
export class NotFoundError extends ServiceError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

/** A uniqueness constraint was violated (e.g. a duplicate project slug). */
export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}
