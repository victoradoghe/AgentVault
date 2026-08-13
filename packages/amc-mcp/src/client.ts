/**
 * Thin HTTP client for the AgentVault REST API.
 *
 * This package contains NO database, embedding, or model code — it is purely
 * a client of the phase-5 REST API, authenticating with the user's API key as
 * a Bearer token. The endpoints below are the contract the MCP tools depend
 * on:
 *
 *   GET    /api/projects
 *   GET    /api/projects/:slug/context
 *   GET    /api/projects/:slug/search?query=&limit=
 *   POST   /api/projects/:slug/memories        { title, content, category?, importance? }
 *   GET    /api/projects/:slug/memories?category=
 *   DELETE /api/memories/:id
 *
 * All responses are parsed defensively: the client accepts either a bare array
 * / string or a `{ data: ... }`-style wrapper so it stays compatible with
 * small shape changes in the API.
 */

import type { AmcConfig } from "./config.js";

/** A saved memory as returned by the API. */
export interface Memory {
  id: string;
  title: string;
  content: string;
  category?: string;
  importance?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Similarity score, present on search results. */
  score?: number;
}

/** A project as returned by the API. */
export interface Project {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
  memoryCount?: number;
}

/**
 * Error the tools can render as a clean message. `retriable` distinguishes
 * transient network/5xx failures (worth retrying) from client errors like a
 * bad API key (not worth retrying).
 */
export class AmcError extends Error {
  readonly status?: number;
  readonly retriable: boolean;

  constructor(message: string, opts: { status?: number; retriable?: boolean } = {}) {
    super(message);
    this.name = "AmcError";
    this.status = opts.status;
    this.retriable = opts.retriable ?? false;
  }
}

/** How long to wait before aborting a request, in milliseconds. */
const REQUEST_TIMEOUT_MS = 20_000;

export class AmcClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AmcConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  // ---- Public API -------------------------------------------------------

  async listProjects(): Promise<Project[]> {
    const body = await this.request("GET", "/api/projects");
    return unwrapArray<Project>(body, "projects");
  }

  /** Returns the markdown context bundle for a project (the "load my memory" call). */
  async getProjectContext(projectSlug: string): Promise<string> {
    const body = await this.request(
      "GET",
      `/api/projects/${encodeURIComponent(projectSlug)}/context`,
      { accept: "text/markdown, application/json" },
    );
    if (typeof body === "string") return body;
    if (body && typeof body === "object") {
      const obj = body as Record<string, unknown>;
      const md = obj.context ?? obj.markdown ?? obj.content ?? obj.data;
      if (typeof md === "string") return md;
    }
    // Fall back to a readable serialisation rather than throwing.
    return typeof body === "string" ? body : JSON.stringify(body, null, 2);
  }

  async searchMemory(projectSlug: string, query: string, limit?: number): Promise<Memory[]> {
    const params = new URLSearchParams({ query });
    if (typeof limit === "number") params.set("limit", String(limit));
    const body = await this.request(
      "GET",
      `/api/projects/${encodeURIComponent(projectSlug)}/search?${params.toString()}`,
    );
    return unwrapArray<Memory>(body, "results", "memories");
  }

  async saveMemory(input: {
    projectSlug: string;
    title: string;
    content: string;
    category?: string;
    importance?: number;
  }): Promise<Memory> {
    const { projectSlug, ...payload } = input;
    const body = await this.request(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/memories`,
      { json: payload },
    );
    return unwrapObject<Memory>(body, "memory");
  }

  async listMemories(projectSlug: string, category?: string): Promise<Memory[]> {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    const qs = params.toString();
    const path = `/api/projects/${encodeURIComponent(projectSlug)}/memories${qs ? `?${qs}` : ""}`;
    const body = await this.request("GET", path);
    return unwrapArray<Memory>(body, "memories");
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.request("DELETE", `/api/memories/${encodeURIComponent(memoryId)}`);
  }

  // ---- Transport --------------------------------------------------------

  private async request(
    method: string,
    path: string,
    opts: { json?: unknown; accept?: string } = {},
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: opts.accept ?? "application/json",
    };
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Network-level failure (DNS, connection refused, timeout, offline).
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : "unknown network error";
      throw new AmcError(
        `Could not reach the AgentVault API at ${this.baseUrl} (${reason}). ` +
          `Check AMC_BASE_URL and your connection, then try again.`,
        { retriable: true },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) throw await this.toError(res);

    // 204 No Content or empty body.
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  /** Maps a non-2xx response to a clear, appropriately-retriable AmcError. */
  private async toError(res: Response): Promise<AmcError> {
    const detail = await this.readErrorMessage(res);

    if (res.status === 401 || res.status === 403) {
      return new AmcError(
        `Authentication failed (${res.status}). Your AMC_API_KEY is missing, ` +
          `invalid, or revoked. Generate a new key in the AgentVault dashboard and ` +
          `update your MCP config.${detail ? ` Server said: ${detail}` : ""}`,
        { status: res.status, retriable: false },
      );
    }
    if (res.status === 404) {
      return new AmcError(
        `Not found (404). The project slug or memory id does not exist for ` +
          `this account.${detail ? ` Server said: ${detail}` : ""}`,
        { status: res.status, retriable: false },
      );
    }
    if (res.status === 429) {
      return new AmcError(
        `Rate limited (429). Wait a moment and try again.${detail ? ` Server said: ${detail}` : ""}`,
        { status: res.status, retriable: true },
      );
    }
    if (res.status >= 500) {
      return new AmcError(
        `The AgentVault API returned a server error (${res.status}). This is usually ` +
          `transient — try again shortly.${detail ? ` Server said: ${detail}` : ""}`,
        { status: res.status, retriable: true },
      );
    }
    return new AmcError(
      `Request failed (${res.status}).${detail ? ` ${detail}` : ""}`,
      { status: res.status, retriable: false },
    );
  }

  /** Best-effort extraction of an error message from a response body. */
  private async readErrorMessage(res: Response): Promise<string | undefined> {
    try {
      const text = await res.text();
      if (!text) return undefined;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const msg = parsed.error ?? parsed.message ?? parsed.detail;
        return typeof msg === "string" ? msg : text.slice(0, 300);
      } catch {
        return text.slice(0, 300);
      }
    } catch {
      return undefined;
    }
  }
}

// ---- Response unwrapping helpers ----------------------------------------

/** Accepts a bare array or a `{ <key>: array }` wrapper. */
function unwrapArray<T>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of [...keys, "data"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** Accepts a bare object or a `{ <key>: object }` wrapper. */
function unwrapObject<T>(body: unknown, ...keys: string[]): T {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    for (const key of [...keys, "data"]) {
      if (obj[key] && typeof obj[key] === "object") return obj[key] as T;
    }
    return body as T;
  }
  return body as T;
}
