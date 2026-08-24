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
 *     so it degrades to a keyword scan over every memory this cache has seen —
 *     from listings, from earlier searches, and from saves made offline. Worse
 *     ranking beats no recall at all.
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

/**
 * How many memories the per-project recall index keeps.
 *
 * It grows by union and nothing prunes it, so it needs a ceiling; a few hundred
 * memories is far more than an offline keyword scan needs and still a small
 * file. Oldest entries fall off first.
 */
const RECALL_INDEX_LIMIT = 500;

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

  /** The flush currently running, if any. See {@link flush}. */
  private flushing: Promise<{ synced: number; failed: number }> | null = null;

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
    return this.read(
      cacheKeys.memories(slug, category),
      () => this.inner.listMemories(slug, category),
      (memories) => this.remember(slug, memories),
    );
  }

  /**
   * Semantic search online; keyword search over everything cached, offline.
   *
   * Search results are not cached under their query — a cache keyed by query
   * only ever hits on a repeated query, which is the rare case. They are folded
   * into the project's recall index instead, so any offline query can be
   * answered, including ones never run before.
   *
   * Scanning only the `list_memories` cache (as this once did) meant the
   * fallback never fired for the workflow the tools actually recommend —
   * `get_project_context`, then `search_memory` — because neither of those
   * calls ever writes that cache. Search failed outright the first time it was
   * needed, which is precisely when it mattered.
   */
  async searchMemory(
    slug: string,
    query: string,
    limit?: number,
  ): Promise<Sourced<Memory[]> & { degraded: boolean }> {
    try {
      const results = await this.inner.searchMemory(slug, query, limit);
      if (this.enabled) this.remember(slug, results);
      await this.flush();
      return { data: results, cachedAt: null, degraded: false };
    } catch (err) {
      if (!this.canFallBack(err)) throw err;

      const known = this.knownMemories(slug);
      if (!known) throw err;

      return {
        data: keywordSearch(known.data, query, limit ?? 10),
        cachedAt: known.cachedAt,
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
      // The server no longer has it, so neither may the cache: otherwise the
      // next dropped connection resurrects a memory the user deleted, and an
      // agent reads it back as current.
      if (this.enabled) this.removeFromCachedMemories(memoryId);
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
   * without the agent (or the user) having to ask.
   *
   * Replaying one entry twice creates a duplicate memory — something the agent
   * cannot detect and the user has to clean up by hand — so two guards stand in
   * the way. Within this process, a caller joins the run already in flight
   * rather than starting a second one; start-up drains the backlog while the
   * first tool call is arriving, so that race is the normal case, not a corner
   * case. Across processes (two agents sharing one cache directory), each entry
   * is claimed with an atomic rename before its request goes out.
   *
   * Two stopping rules:
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
    if (this.flushing) return this.flushing;

    const run = this.runFlush();
    this.flushing = run;
    try {
      return await run;
    } finally {
      this.flushing = null;
    }
  }

  private async runFlush(): Promise<{ synced: number; failed: number }> {
    const entries = this.store.pending();
    if (entries.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const entry of entries) {
      // Lost the race for this entry: another runner is sending it right now.
      // Skipping is the point — sending it too is what duplicates the memory.
      if (!this.store.claim(entry.id)) continue;

      try {
        await this.replay(entry);
        this.store.resolve(entry.id);
        synced += 1;
      } catch (err) {
        if (isOffline(err)) {
          // Never delivered — put it back so the next attempt finds it.
          this.store.release(entry.id);
          break;
        }

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
  private async read<T>(
    key: string,
    fetcher: () => Promise<T>,
    /** Runs on a fresh (online) result, before the flush, when caching is on. */
    onFresh?: (data: T) => void,
  ): Promise<Sourced<T>> {
    try {
      const data = await fetcher();
      if (this.enabled) {
        this.store.write(key, data);
        onFresh?.(data);
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
    this.remember(slug, [memory]);
  }

  /**
   * Fold memories into the project's recall index — the pool offline search
   * scans.
   *
   * Kept separate from the `list_memories` cache because the two answer
   * different questions. That cache must mirror one server response exactly, or
   * `list_memories` would report memories the server did not return. The index
   * has no such duty: it is a best-effort union of everything seen, newest
   * first, and being incomplete only costs recall — which beats the previous
   * behaviour of failing the call outright.
   */
  private remember(slug: string, memories: Memory[]): void {
    if (!this.enabled || memories.length === 0) return;

    const key = cacheKeys.recall(slug);
    const existing = this.store.read<Memory[]>(key)?.data ?? [];
    const merged = new Map<string, Memory>();
    // Freshest wins: incoming entries are inserted first, so a stale copy of the
    // same id from the index is not written back over an updated one.
    for (const memory of [...memories, ...existing]) {
      if (!merged.has(memory.id)) merged.set(memory.id, memory);
    }

    this.store.write(key, [...merged.values()].slice(0, RECALL_INDEX_LIMIT));
  }

  /**
   * Every memory cached for a project, from any source, for offline search.
   * Null when nothing has ever been cached — there is genuinely nothing to
   * scan, so the caller re-throws the offline error.
   */
  private knownMemories(slug: string): { data: Memory[]; cachedAt: number } | null {
    const listed = this.store.read<Memory[]>(cacheKeys.memories(slug));
    const indexed = this.store.read<Memory[]>(cacheKeys.recall(slug));
    if (!listed && !indexed) return null;

    const merged = new Map<string, Memory>();
    for (const memory of [...(listed?.data ?? []), ...(indexed?.data ?? [])]) {
      if (!merged.has(memory.id)) merged.set(memory.id, memory);
    }

    return {
      data: [...merged.values()],
      // Report the age of the freshest thing scanned, so the agent is not told
      // the results are older than they are.
      cachedAt: Math.max(listed?.cachedAt ?? 0, indexed?.cachedAt ?? 0),
    };
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
      // Both pools, independently: a project can have a recall index built from
      // searches without ever having been listed. Missing the index would leave
      // the deleted memory turning up in offline searches forever, since nothing
      // else ever removes an entry from it.
      this.purgeCached(cacheKeys.memories(project.slug), memoryId);
      this.purgeCached(cacheKeys.recall(project.slug), memoryId);
    }
  }

  /** Drop one memory from a cached list, leaving an absent cache untouched. */
  private purgeCached(key: string, memoryId: string): void {
    const cached = this.store.read<Memory[]>(key);
    if (!cached) return;

    const remaining = cached.data.filter((m) => m.id !== memoryId);
    if (remaining.length !== cached.data.length) this.store.write(key, remaining);
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
