"use client";

/**
 * Browser API client for the dashboard.
 *
 * The dashboard talks to the same REST API the MCP server uses, authenticated
 * by the Supabase session cookie (sent automatically on same-origin fetches).
 * Keeping one data path means the UI exercises exactly what agents hit.
 *
 * Types here are intentionally light and standalone (no server imports) so this
 * stays in the client bundle without dragging Prisma along.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  memoryCount: number;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  title: string;
  content: string;
  category: string;
  importance: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult extends MemoryRecord {
  score: number;
}

export interface ApiKeySummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  maskedKey: string;
}

export interface CreatedApiKey {
  id: string;
  key: string;
  label: string | null;
  createdAt: string;
}

export interface MemoryInput {
  title: string;
  content: string;
  category?: string;
  importance?: number;
}

/** An error carrying the HTTP status and the server's message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  // Projects
  listProjects: () =>
    request<{ projects: ProjectSummary[] }>("/api/projects").then((r) => r.projects),
  createProject: (name: string) =>
    request<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }).then((r) => r.project),
  deleteProject: (slug: string) =>
    request<void>(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" }),

  // Memories
  listMemories: (slug: string, category?: string) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : "";
    return request<{ memories: MemoryRecord[] }>(
      `/api/projects/${encodeURIComponent(slug)}/memories${qs}`,
    ).then((r) => r.memories);
  },
  createMemory: (slug: string, input: MemoryInput) =>
    request<{ memory: MemoryRecord }>(
      `/api/projects/${encodeURIComponent(slug)}/memories`,
      { method: "POST", body: JSON.stringify(input) },
    ).then((r) => r.memory),
  updateMemory: (id: string, input: Partial<MemoryInput>) =>
    request<{ memory: MemoryRecord }>(`/api/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.memory),
  deleteMemory: (id: string) =>
    request<void>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  searchMemories: (slug: string, query: string, limit?: number) => {
    const params = new URLSearchParams({ query });
    if (limit != null) params.set("limit", String(limit));
    return request<{ results: SearchResult[] }>(
      `/api/projects/${encodeURIComponent(slug)}/search?${params.toString()}`,
    ).then((r) => r.results);
  },
  getContext: (slug: string) =>
    fetch(`/api/projects/${encodeURIComponent(slug)}/context`, {
      headers: { Accept: "text/markdown" },
    }).then((r) => r.text()),

  // API keys
  listKeys: () => request<{ keys: ApiKeySummary[] }>("/api/keys").then((r) => r.keys),
  createKey: (label?: string) =>
    request<{ key: CreatedApiKey }>("/api/keys", {
      method: "POST",
      body: JSON.stringify({ label: label ?? null }),
    }).then((r) => r.key),
  revokeKey: (id: string) =>
    request<void>(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
