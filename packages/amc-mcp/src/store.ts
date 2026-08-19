/**
 * On-disk cache and write queue for the MCP server.
 *
 * An agent's memory is most valuable exactly when the network isn't there — on
 * a train, on hotel wifi, mid-outage. Without this file a dropped connection
 * means `get_project_context` fails (the agent starts the task cold, blind to
 * every prior decision) and, far worse, `save_memory` throws and the fact the
 * agent just learned is gone for good. The agent has no retry buffer of its
 * own: once the tool call returns an error, that content is out of its hands.
 *
 * So two things live here:
 *
 *   1. **A read cache.** Every successful GET is mirrored to disk and replayed
 *      when the API is unreachable, so an offline agent still inherits context.
 *   2. **An outbox.** Writes made while offline are appended to a durable queue
 *      and replayed on the next call that reaches the server. Nothing an agent
 *      saves is lost to a bad connection.
 *
 * Storage is plain JSON files under the user's home directory rather than a
 * database: the payloads are small, the process is short-lived and may run many
 * times a day, and a human debugging "did my memory sync?" can just read them.
 *
 * Two invariants:
 *
 *   - **Entries are namespaced per credential.** The directory name is derived
 *     from the base URL *and* the API key, so two accounts (or a local dev
 *     server and the hosted one) sharing a machine can never read each other's
 *     cached memories.
 *   - **Every write is atomic.** Files are written to a temp path and renamed,
 *     because this process can be killed at any moment by the agent that
 *     spawned it, and a half-written outbox entry would be a lost memory.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Bumped when cached shapes change; older entries are ignored, not migrated. */
const CACHE_VERSION = 1;

/** Default root for cached data, overridable with AMC_CACHE_DIR. */
export function defaultCacheRoot(): string {
  return path.join(os.homedir(), ".agentvault");
}

/** A cached payload and when it was stored. */
export interface CacheHit<T> {
  data: T;
  /** Epoch milliseconds at which this entry was written. */
  cachedAt: number;
}

interface CacheEnvelope<T> extends CacheHit<T> {
  v: number;
}

/** A write an agent made while the API was unreachable. */
export interface OutboxEntry {
  id: string;
  /** Epoch milliseconds at which the agent made the call. */
  queuedAt: number;
  kind: "save" | "delete";
  /** Arguments for the original call, replayed verbatim on flush. */
  payload: Record<string, unknown>;
}

/**
 * Short, stable directory name for one (base URL, API key) pair.
 *
 * The key is hashed rather than stored: this path shows up in logs, shell
 * prompts and screenshots, and a credential should not be sitting in a
 * filename. Truncating to 16 hex chars is ample to separate a handful of
 * accounts on one machine.
 */
export function namespaceFor(baseUrl: string, apiKey: string): string {
  return createHash("sha256").update(`${baseUrl} ${apiKey}`).digest("hex").slice(0, 16);
}

export class OfflineStore {
  private readonly cacheDir: string;
  private readonly outboxDir: string;

  constructor(root: string, namespace: string) {
    const base = path.join(root, namespace);
    this.cacheDir = path.join(base, "cache");
    this.outboxDir = path.join(base, "outbox");
  }

  // ---- Read cache -------------------------------------------------------

  /** Read a cached payload, or null if absent, unreadable, or stale-shaped. */
  read<T>(key: string): CacheHit<T> | null {
    const file = this.cacheFile(key);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (parsed.v !== CACHE_VERSION || typeof parsed.cachedAt !== "number") {
        this.discard(file);
        return null;
      }
      return { data: parsed.data, cachedAt: parsed.cachedAt };
    } catch {
      // Corrupt (truncated by a kill, edited by hand) — drop it rather than
      // letting one bad file fail every future read.
      this.discard(file);
      return null;
    }
  }

  /**
   * Mirror a payload to disk. Failures are swallowed on purpose: an unwritable
   * cache means "no offline copy", which is a degraded experience, not an error
   * worth failing an otherwise successful API call over.
   */
  write<T>(key: string, data: T): void {
    const envelope: CacheEnvelope<T> = { v: CACHE_VERSION, cachedAt: Date.now(), data };
    try {
      this.atomicWrite(this.cacheFile(key), JSON.stringify(envelope));
    } catch {
      // Disk full, read-only home, permissions. Carry on uncached.
    }
  }

  // ---- Outbox -----------------------------------------------------------

  /** Durably queue a write for replay. Throws if it cannot be persisted. */
  enqueue(kind: OutboxEntry["kind"], payload: Record<string, unknown>): OutboxEntry {
    const entry: OutboxEntry = { id: randomUUID(), queuedAt: Date.now(), kind, payload };
    // Deliberately NOT swallowed: if this throws, the caller must report the
    // save as failed rather than telling the agent it was safely queued.
    this.atomicWrite(this.entryFile(entry.id), JSON.stringify(entry));
    return entry;
  }

  /**
   * Queued writes, oldest first, so replay preserves the order the agent made
   * them in. Unreadable entries are dropped rather than blocking the queue.
   */
  pending(): OutboxEntry[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.outboxDir);
    } catch {
      return [];
    }

    const entries: OutboxEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(this.outboxDir, name);
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OutboxEntry;
        if (parsed?.id && parsed.kind) entries.push(parsed);
        else this.discard(file);
      } catch {
        this.discard(file);
      }
    }
    return entries.sort((a, b) => a.queuedAt - b.queuedAt);
  }

  /** Number of queued writes, without parsing them. */
  pendingCount(): number {
    try {
      return fs.readdirSync(this.outboxDir).filter((n) => n.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  /** Drop a queued write once the server has accepted it. */
  resolve(id: string): void {
    this.discard(this.entryFile(id));
  }

  // ---- Internals --------------------------------------------------------

  private cacheFile(key: string): string {
    // Keys are built from user-supplied project slugs and search queries, so
    // they are hashed rather than used as filenames — a slug containing "/" or
    // ".." would otherwise escape the cache directory.
    const safe = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return path.join(this.cacheDir, `${safe}.json`);
  }

  private entryFile(id: string): string {
    // Ids come from randomUUID(), so they are already path-safe.
    return path.join(this.outboxDir, `${id}.json`);
  }

  private discard(file: string): void {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Already gone, or not ours to delete.
    }
  }

  /**
   * Write via a temp file and rename, so a reader (or a `kill -9`) never sees a
   * partially written file. Rename is atomic within a filesystem, and the temp
   * file is a sibling of the target to guarantee they share one.
   */
  private atomicWrite(file: string, contents: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, contents, "utf8");
      fs.renameSync(tmp, file);
    } catch (err) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // Best effort.
      }
      throw err;
    }
  }
}

/** Cache keys, kept together so reader and writer can't drift apart. */
export const cacheKeys = {
  projects: () => "projects",
  context: (slug: string) => `context:${slug}`,
  memories: (slug: string, category?: string) => `memories:${slug}:${category ?? "all"}`,
} as const;
