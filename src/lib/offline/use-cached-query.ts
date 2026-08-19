"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { useOffline } from "@/components/offline-provider";
import { readCache, writeCache } from "./cache";

/**
 * Read a piece of dashboard data with an offline fallback.
 *
 * The sequence on every mount (and whenever `cacheKey` changes) is:
 *
 *   1. Paint the cached copy synchronously, if there is one. No skeleton, no
 *      flash — on a warm cache the table is on screen in the first frame.
 *   2. Fetch in the background and replace it with the truth.
 *   3. If that fetch never reaches the server, keep showing the cached copy and
 *      mark it stale, so the UI can say *when* it's from and switch to
 *      read-only. Only a cold cache surfaces an actual error.
 *
 * Distinguishing "server said no" from "couldn't reach the server" is the whole
 * trick, and `ApiError` carries it: the API client only throws one when it got
 * an HTTP response back. Anything else out of `fetch` is a transport failure.
 */

export interface CachedQuery<T> {
  /** The data to render: fresh, or cached, or null when neither exists. */
  data: T | null;
  /** When `data` was cached, if it came from the cache. */
  cachedAt: number | null;
  /** True while showing cached data because the server is unreachable. */
  stale: boolean;
  /** True during the very first load with nothing cached to show. */
  loading: boolean;
  /** Set only when there is nothing at all to display. */
  error: string | null;
  /** Refetch on demand (after a mutation, or a manual retry). */
  refresh: () => void;
}

export function useCachedQuery<T>(
  /** Cache key within the user's namespace; null disables the query. */
  cacheKey: string | null,
  /** Must be `useCallback`-stable — it is a dependency of the fetch effect. */
  fetcher: () => Promise<T>,
): CachedQuery<T> {
  const { namespace, reconnectedAt, reportResult } = useOffline();

  const [data, setData] = useState<T | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!cacheKey) return;

    let cancelled = false;

    // 1. Cached copy first, so there is something on screen immediately.
    const cached = readCache<T>(namespace, cacheKey);
    if (cached) {
      setData(cached.data);
      setCachedAt(cached.cachedAt);
      setLoading(false);
    } else {
      setData(null);
      setCachedAt(null);
      setLoading(true);
    }
    setError(null);

    // 2. Then the network.
    void fetcher()
      .then((fresh) => {
        if (cancelled) return;
        writeCache(namespace, cacheKey, fresh);
        setData(fresh);
        setCachedAt(null);
        setStale(false);
        setLoading(false);
        reportResult(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        // An HTTP response — however unhappy — proves the server is reachable.
        const reachable = err instanceof ApiError;
        reportResult(reachable);

        setLoading(false);
        if (cached) {
          // 3. Keep showing what we have; the banner explains why it's old.
          setStale(true);
          return;
        }
        setStale(false);
        setError(
          err instanceof ApiError
            ? err.message
            : "Can't reach the server, and nothing is cached for this view yet.",
        );
      });

    return () => {
      cancelled = true;
    };
    // `reconnectedAt` changes when connectivity is restored, which is exactly
    // when this should run again.
  }, [cacheKey, fetcher, namespace, attempt, reconnectedAt, reportResult]);

  return { data, cachedAt, stale, loading, error, refresh };
}
