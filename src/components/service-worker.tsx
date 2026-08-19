"use client";

import { useEffect } from "react";

/**
 * Registers (or removes) the offline service worker.
 *
 * Production only, on purpose. `public/sw.js` serves `/_next/static/*`
 * cache-first, which is correct for content-hashed build output and actively
 * wrong for a dev server, where those paths are rebuilt in place — a stale hit
 * would hand the browser chunks from before your last edit. Dev also has no
 * need for it: the server is on localhost.
 *
 * The dev branch actively unregisters instead of just skipping, so a worker
 * installed by a production build on the same origin (`localhost:3000` is both)
 * can't linger and break the next `pnpm dev`.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
        .catch(() => {
          // Nothing to clean up, or the browser refused. Either way, harmless.
        });
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is an enhancement: without it the app still works online,
      // it just can't be opened offline. Not worth surfacing to the user.
    });
  }, []);

  return null;
}

/**
 * Ask the worker to drop every cached page. Called on sign-out, alongside
 * clearing the data cache — a shared machine must not keep the previous user's
 * dashboard openable offline.
 */
export function clearServiceWorkerCache(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "amc-clear-cache" });
  } catch {
    // No worker registered, or messaging blocked. Nothing to clear.
  }
}
