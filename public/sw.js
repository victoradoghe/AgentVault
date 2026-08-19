/**
 * AgentVault service worker — makes the dashboard *reachable* with no network.
 *
 * The localStorage cache (src/lib/offline/cache.ts) holds the memories, but it
 * can only help once the page is running, and a page can't run if the browser
 * couldn't fetch its HTML. Without this file, opening the dashboard offline
 * gets the browser's own error page and the cached data is never reached. So
 * this caches the shell — documents and Next's build assets — and the two
 * layers together are what "readable offline" actually requires.
 *
 * Deliberately NOT cached: anything under /api. Those responses are per-user
 * and authenticated; replaying them from a shared cache is how one account ends
 * up seeing another's data. API results have their own namespaced cache with an
 * explicit clear-on-sign-out, and that is the only place they live.
 */

const VERSION = "v1";
const DOCUMENT_CACHE = `amc-documents-${VERSION}`;
const ASSET_CACHE = `amc-assets-${VERSION}`;
const CURRENT_CACHES = [DOCUMENT_CACHE, ASSET_CACHE];

self.addEventListener("install", (event) => {
  // Nothing to precache: Next's asset filenames are content-hashed per build
  // and unknown here, so the caches fill from real traffic instead.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this worker.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("amc-") && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Sign-out asks us to forget every cached page. */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "amc-clear-cache") return;
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("amc-")).map((name) => caches.delete(name)),
      );
    })(),
  );
});

/** Last-resort page when a navigation fails and nothing is cached for it. */
function offlineFallback() {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Offline · AgentVault</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             font: 15px/1.6 ui-sans-serif, system-ui, sans-serif;
             background: #fafafa; color: #18181b; }
      @media (prefers-color-scheme: dark) { body { background: #09090b; color: #fafafa; } }
      main { max-width: 26rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
      p { margin: 0; opacity: .7; }
    </style>
  </head>
  <body>
    <main>
      <h1>You're offline</h1>
      <p>This page hasn't been opened on this device yet, so there's no cached
         copy to show. Reconnect and try again.</p>
    </main>
  </body>
</html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Documents: network-first. A dashboard shell is cheap to fetch and must not go
 * stale while online, so the cached copy is strictly a fallback.
 */
async function handleDocument(request) {
  const cache = await caches.open(DOCUMENT_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      // Any dashboard page can stand in for another: they share a shell and
      // fetch their own data client-side once running.
      (await cache.match("/dashboard")) ??
      offlineFallback()
    );
  }
}

/**
 * Build assets: cache-first. Everything under /_next/static is content-hashed,
 * so a hit is always correct and a new build simply asks for new filenames.
 */
async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only GETs are cacheable, and only our own origin is ours to cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Per-user, authenticated, and already cached elsewhere — see the file header.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleDocument(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleAsset(request));
  }
});
