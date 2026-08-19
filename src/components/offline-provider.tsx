"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { namespaceFor } from "@/lib/offline/cache";

/**
 * Connectivity state for the dashboard.
 *
 * "Offline" here means *the API is unreachable*, which is not the same thing as
 * `navigator.onLine`. That flag only reports whether the machine has a network
 * interface up: it is happily `true` on a captive-portal wifi, and it says
 * nothing about our server being down or the database being unreachable. So the
 * authoritative signal is what actually happened to the last request — a fetch
 * that never got a response means offline; an `ApiError` means the server
 * answered (even if it answered 500), so we are online.
 *
 * `navigator.onLine` is still used, but only for the two things it is good at:
 * flipping to offline instantly when the interface drops (no need to wait for a
 * request to time out), and telling us when to retry.
 */

export interface OfflineState {
  /** localStorage namespace for the signed-in user. */
  namespace: string;
  /** True when the API is unreachable and cached data is being shown. */
  offline: boolean;
  /**
   * Bumped whenever connectivity is restored. Consumers use it as a `useEffect`
   * dependency to refetch, so coming back online refreshes what's on screen.
   */
  reconnectedAt: number;
  /** Report the outcome of an API call. See the note on `navigator.onLine`. */
  reportResult(reachable: boolean): void;
}

const OfflineContext = createContext<OfflineState | null>(null);

export function useOffline(): OfflineState {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline must be used inside <OfflineProvider>.");
  }
  return ctx;
}

export function OfflineProvider({
  identity,
  children,
}: {
  /** The signed-in user's email; scopes the cache to this account. */
  identity: string | null;
  children: React.ReactNode;
}) {
  const [offline, setOffline] = useState(false);
  const [reconnectedAt, setReconnectedAt] = useState(0);

  const namespace = useMemo(() => namespaceFor(identity), [identity]);

  const reportResult = useCallback((reachable: boolean) => {
    setOffline((wasOffline) => {
      // Recovering from offline is what consumers need to know about, so only
      // bump the refetch signal on that edge — not on every successful call.
      if (wasOffline && reachable) setReconnectedAt(Date.now());
      return !reachable;
    });
  }, []);

  useEffect(() => {
    // The interface dropping is proof we're offline; it coming back is only a
    // hint that a retry is worth making, so let the next request decide.
    const goOffline = () => setOffline(true);
    const goOnline = () => reportResult(true);

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [reportResult]);

  const value = useMemo<OfflineState>(
    () => ({ namespace, offline, reconnectedAt, reportResult }),
    [namespace, offline, reconnectedAt, reportResult],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
