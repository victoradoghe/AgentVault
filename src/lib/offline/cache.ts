"use client";

/**
 * Local read-through cache for dashboard data.
 *
 * The dashboard reads everything through the REST API, which means an
 * unreachable server (a dropped connection, a sleeping laptop, a database
 * hiccup) previously left the user staring at an error toast and an empty
 * table. The memories your agents saved are exactly the thing you want to read
 * when you're on a train with no signal, so every successful GET is mirrored
 * here and replayed when the network isn't there.
 *
 * Storage is `localStorage`, not IndexedDB: the payloads are small text records,
 * a synchronous read means cached rows paint on the first frame instead of
 * flashing a skeleton, and there is no schema to migrate. If a payload ever
 * outgrows the ~5 MB budget, writes fail softly (see `writeCache`) — a cache
 * miss degrades to today's behaviour, it never breaks the page.
 *
 * Two invariants matter more than the mechanism:
 *
 *   1. **Entries are namespaced per user.** Signing out and back in as someone
 *      else must never surface the previous account's memories, so the acting
 *      identity is part of every key.
 *   2. **This cache is read-only data.** Nothing here is ever treated as the
 *      source of truth for a write; it only decides what to *show*.
 */

/**
 * Bumped when the cached shapes change. Entries written by an older version are
 * ignored and swept away rather than being handed to code expecting new fields.
 */
const CACHE_VERSION = 1;

const KEY_PREFIX = "amc_cache";

/** A cached payload plus when it was written. */
export interface CacheEntry<T> {
  data: T;
  /** Epoch milliseconds at which this entry was stored. */
  cachedAt: number;
}

/** The stored envelope; `v` lets us detect and drop stale-shaped entries. */
interface StoredEntry<T> extends CacheEntry<T> {
  v: number;
}

/**
 * Namespace for one signed-in user. The email is hashed to a short, stable
 * token so the raw address isn't sitting in `localStorage` keys (it is already
 * in the app, but keys leak into devtools screenshots and bug reports).
 */
export function namespaceFor(identity: string | null | undefined): string {
  if (!identity) return "anon";
  const normalised = identity.trim().toLowerCase();

  // FNV-1a — not cryptographic, and it doesn't need to be: this only has to
  // separate one account's entries from another's on the same device.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function storageKey(namespace: string, key: string): string {
  return `${KEY_PREFIX}:${namespace}:${key}`;
}

/** `localStorage`, or null where it isn't usable (SSR, private mode, blocked). */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read a cached entry, or null if absent, unreadable, or of an old version. */
export function readCache<T>(namespace: string, key: string): CacheEntry<T> | null {
  const store = storage();
  if (!store) return null;

  const raw = store.getItem(storageKey(namespace, key));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredEntry<T>;
    if (parsed.v !== CACHE_VERSION || typeof parsed.cachedAt !== "number") {
      store.removeItem(storageKey(namespace, key));
      return null;
    }
    return { data: parsed.data, cachedAt: parsed.cachedAt };
  } catch {
    // Corrupt entry — drop it rather than letting it fail every future read.
    store.removeItem(storageKey(namespace, key));
    return null;
  }
}

/**
 * Store a payload. Failures are swallowed deliberately: a full or unavailable
 * quota means "no offline copy of this view", which is a degraded experience,
 * not an error the user can act on.
 */
export function writeCache<T>(namespace: string, key: string, data: T): number {
  const cachedAt = Date.now();
  const store = storage();
  if (!store) return cachedAt;

  const entry: StoredEntry<T> = { v: CACHE_VERSION, cachedAt, data };
  try {
    store.setItem(storageKey(namespace, key), JSON.stringify(entry));
  } catch {
    // Most likely QuotaExceededError. Free the space this app is responsible
    // for and retry once; if it still fails, carry on without a cached copy.
    try {
      clearCache();
      store.setItem(storageKey(namespace, key), JSON.stringify(entry));
    } catch {
      // Give up silently.
    }
  }
  return cachedAt;
}

/**
 * Drop every cached entry this app owns, across all namespaces. Called on sign
 * out — a shared machine must not keep the previous user's memories readable.
 */
export function clearCache(): void {
  const store = storage();
  if (!store) return;

  const doomed: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(`${KEY_PREFIX}:`)) doomed.push(key);
  }
  for (const key of doomed) store.removeItem(key);
}

/** Cache keys, kept together so they can't drift between reader and writer. */
export const cacheKeys = {
  projects: () => "projects",
  memories: (slug: string, category?: string) =>
    `memories:${slug}:${category ?? "all"}`,
} as const;
