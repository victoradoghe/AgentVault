/**
 * Offline behaviour for the MCP tools.
 *
 * `AmcClient` stays a pure HTTP client — it knows nothing about disks or
 * queues. This wrapper sits between it and the tools and applies one rule:
 *
 *   **A missing network degrades the answer; it never loses the work.**
 *
 * Concretely, per call:
 *
 *   - Reads hit the API, mirror the result to disk, and fall back to that copy
 *     when the API is unreachable. The tool is told the data is cached and how
 *     old it is, so the agent can say so rather than presenting stale decisions
 *     as current.
 *   - `search_memory` has no offline equivalent of the server's vector search,
 *     so it degrades to a keyword scan over the cached memories. Worse ranking
 *     beats no recall at all.
 *   - Writes go to a durable outbox when offline and are replayed, in order, on
 *     the next call that reaches the server.
 *
 * The fallback is deliberately keyed on `AmcError.offline` — "we never got a
 * response" — not on `retriable`. A 401 or a 500 must surface as the error it
 * is; silently serving a cached copy would turn a revoked API key into a
 * mysteriously frozen memory.
 */

import {
  AmcClient,
  AmcError,
  type Memory,
  type Project,
} from "./client.js";
import { cacheKeys, OfflineStore, type OutboxEntry } from "./store.js";

/**
 * A value plus its provenance. `cachedAt` is null when the value came from the
 * API just now, and an epoch-millisecond timestamp when it came from disk
 * because the API was unreachable.
 */
export interface Sourced<T> {
  data: T;
  cachedAt: number | null;
}

/** Outcome of a save: it either reached the server or is queued on disk. */
export interface SaveOutcome {
  status: "saved" | "queued";
  /** The server's record, when it was saved online. */
  memory?: Memory;
  /** Local placeholder id, when queued. */
  localId?: string;
  /** How many writes are now waiting to sync. */
  pending: number;
}

/** Outcome of a delete, mirroring {@link SaveOutcome}. */
export interface DeleteOutcome {
  status: "deleted" | "queued" | "unqueued";
  pending: number;
}

/**
 * Ids handed out for memories saved offline. Prefixed so it is obvious in an
 * agent transcript that the id is not yet a server id, and so a later delete of
 * a still-unsynced memory can be recognised and handled locally.
 */
const LOCAL_ID_PREFIX = "local:";

function isOffline(err: unknown): boolean {
  return err instanceof AmcError && err.offline;
}

export class OfflineClient {
  constructor(
    private readonly inner: AmcClient,
    private readonly store: OfflineStore,
    /**
     * When false (AMC_OFFLINE=0) nothing touches the disk and every failure
     * surfaces as the error it is — the plain HTTP behaviour.
     */
    private readonly enabled: boolean = true,
    /** Where flush progress is reported. stdout carries JSON-RPC, so: stderr. */
    private readonly log: (message: string) => void = (m) => console.error(m),
  ) {}

  /** True when a failure should fall back to disk rather than propagate. */
  private canFallBack(err: unknown): boolean {
    return this.enabled && isOffline(err);
  }

  // ---- Reads ------------------------------------------------------------

  async listProjects(): Promise<Sourced<Project[]>> {
    return this.read(cacheKeys.projects(), () => this.inner.listProjects());
  }

  async getProjectContext(slug: string): Promise<Sourced<string>> {
    return this.read(cacheKeys.context(slug), () => this.inner.getProjectContext(slug));
  }

  async listMemories(slug: string, category?: string): Promise<Sourced<Memory[]>> {
    return this.read(cacheKeys.memories(slug, category), () =>
      this.inner.listMemories(slug, category),
    );
  }

  /**
   * Semantic search online; keyword search over the cached memories offline.
   *
   * Search results are not themselves cached — a cache keyed by query only ever
   * hits on a repeated query, which is the rare case. Scanning the cached
   * memory list instead answers *any* offline query, including ones never run
   * before.
   */
  async searchMemory(
    slug: string,
    query: string,
    limit?: number,
  ): Promise<Sourced<Memory[]> & { degraded: boolean }> {
    try {
      const results = await this.inner.searchMemory(slug, query, limit);
      await this.flush();
      return { data: results, cachedAt: null, degraded: false };
    } catch (err) {
      if (!this.canFallBack(err)) throw err;

      const cached = this.store.read<Memory[]>(cacheKeys.memories(slug));
      if (!cached) throw err;

      return {
        data: keywordSearch(cached.data, query, limit ?? 10),
        cachedAt: cached.cachedAt,
        degraded: true,
      };
    }
  }

  // ---- Writes -----------------------------------------------------------

  async saveMemory(input: {
    projectSlug: string;
    title: string;
    content: string;
    category?: string;
    importance?: number;
  }): Promise<SaveOutcome> {
    try {
      const memory = await this.inner.saveMemory(input);
      await this.flush();
      return { status: "saved", memory, pending: this.pendingCount() };
    } catch (err) {
      if (!this.canFallBack(err)) throw err;

      // Let an enqueue failure propagate: telling an agent its memory is safely
      // queued when it isn't is the one lie this module must never tell.
      const entry = this.store.enqueue("save", { ...input });
      const localId = `${LOCAL_ID_PREFIX}${entry.id}`;

      // Reflect the write in the cached list straight away, so a follow-up
      // list/search in this same offline session sees what was just saved.
      this.addToCachedMemories(input.projectSlug, {
        id: localId,
        title: input.title,
        content: input.content,
        category: input.category,
        importance: input.importance,
        createdAt: new Date(entry.queuedAt).toISOString(),
      });

      return { status: "queued", localId, pending: this.store.pendingCount() };
    }
  }

  async deleteMemory(memoryId: string): Promise<DeleteOutcome> {
    // Deleting something that never reached the server: drop the queued save
    // instead of queueing a delete for an id the server has never seen.
    if (memoryId.startsWith(LOCAL_ID_PREFIX)) {
      this.store.resolve(memoryId.slice(LOCAL_ID_PREFIX.length));
      this.removeFromCachedMemories(memoryId);
      return { status: "unqueued", pending: this.store.pendingCount() };
    }

    try {
      await this.inner.deleteMemory(memoryId);
      await this.flush();
      return { status: "deleted", pending: this.pendingCount() };
    } catch (err) {
      if (!this.canFallBack(err)) throw err;

      this.store.enqueue("delete", { memoryId });
      this.removeFromCachedMemories(memoryId);
      return { status: "queued", pending: this.store.pendingCount() };
    }
  }

  // ---- Sync -------------------------------------------------------------

  /** Writes still waiting to reach the server. */
  pendingCount(): number {
    return this.enabled ? this.store.pendingCount() : 0;
  }

  /**
   * Replay queued writes, oldest first.
   *
   * Called after every successful API call, so reconnecting syncs the backlog
   * without the agent (or the user) having to ask. Two stopping rules:
   *
   *   - The first offline failure aborts the run and leaves the rest queued.
   *     The network went away again; retrying the remainder just burns time.
   *   - An entry the server *rejects* (404 on a deleted project, 400 on a
   *     since-tightened validation rule) is dropped, because replaying it on
   *     every future call would block the queue forever. It is logged loudly so
   *     the loss is visible rather than silent.
   */
  async flush(): Promise<{ synced: number; failed: number }> {
    if (!this.enabled) return { synced: 0, failed: 0 };

    const entries = this.store.pending();
    if (entries.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        await this.replay(entry);
        this.store.resolve(entry.id);
        synced += 1;
      } catch (err) {
        if (isOffline(err)) break;

        this.store.resolve(entry.id);
        failed += 1;
        const reason = err instanceof Error ? err.message : String(err);
        this.log(
          `amc-mcp: dropped a queued ${entry.kind} from ` +
            `${new Date(entry.queuedAt).toISOString()} — the server rejected it: ${reason}`,
        );
      }
    }

    if (synced > 0) this.log(`amc-mcp: synced ${synced} queued write(s).`);
    return { synced, failed };
  }

  private async replay(entry: OutboxEntry): Promise<void> {
    if (entry.kind === "save") {
      const p = entry.payload as {
        projectSlug: string;
        title: string;
        content: string;
        category?: string;
        importance?: number;
      };
      await this.inner.saveMemory(p);
      return;
    }

    const { memoryId } = entry.payload as { memoryId: string };
    try {
      await this.inner.deleteMemory(memoryId);
    } catch (err) {
      // The memory being gone is the outcome this entry wanted. Anything else
      // is a real failure and should be handled by the caller.
      if (err instanceof AmcError && err.status === 404) return;
      throw err;
    }
  }

  // ---- Internals --------------------------------------------------------

  /**
   * Fetch, mirror to disk, and fall back to the mirror when unreachable.
   * A cold cache re-throws: there is genuinely nothing to show.
   */
  private async read<T>(key: string, fetcher: () => Promise<T>): Promise<Sourced<T>> {
    try {
      const data = await fetcher();
      if (this.enabled) {
        this.store.write(key, data);
        await this.flush();
      }
      return { data, cachedAt: null };
    } catch (err) {
      if (!this.canFallBack(err)) throw err;

      const cached = this.store.read<T>(key);
      if (!cached) throw err;
      return { data: cached.data, cachedAt: cached.cachedAt };
    }
  }

  /** Prepend a just-queued memory to the cached list for its project. */
  private addToCachedMemories(slug: string, memory: Memory): void {
    const key = cacheKeys.memories(slug);
    const cached = this.store.read<Memory[]>(key);
    this.store.write(key, [memory, ...(cached?.data ?? [])]);
  }

  /**
   * Drop a memory from every cached list it might appear in.
   *
   * The project slug isn't known here (delete takes only an id), and the same
   * memory is cached once per category filter that has been listed, so this
   * sweeps the lists it can reach: the unfiltered one per project. Category
   * lists refresh on the next successful online call.
   */
  private removeFromCachedMemories(memoryId: string): void {
    const projects = this.store.read<Project[]>(cacheKeys.projects());
    for (const project of projects?.data ?? []) {
      const key = cacheKeys.memories(project.slug);
      const cached = this.store.read<Memory[]>(key);
      if (!cached) continue;

      const remaining = cached.data.filter((m) => m.id !== memoryId);
      if (remaining.length !== cached.data.length) this.store.write(key, remaining);
    }
  }
}

/**
 * Offline stand-in for the server's vector search.
 *
 * Scores each memory on where the query's terms appear, since a term in the
 * title is a much stronger signal than one buried in the body. There is no
 * pretence of semantic matching — the score is reported to the agent as
 * keyword-based so it doesn't read the ranking as more meaningful than it is.
 */
export function keywordSearch(memories: Memory[], query: string, limit: number): Memory[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);

  if (terms.length === 0) return memories.slice(0, limit);

  const scored = memories.map((memory) => {
    const title = memory.title.toLowerCase();
    const content = memory.content.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      if (content.includes(term)) score += 1;
    }
    // Nudge by importance so equally-matching memories surface the ones the
    // agent marked as mattering more.
    score += ((memory.importance ?? 3) - 3) * 0.1;

    return { memory, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.memory);
}
