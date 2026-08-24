import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AmcClient } from "../packages/amc-mcp/src/client";
import { OfflineClient, keywordSearch } from "../packages/amc-mcp/src/offline";
import { OfflineStore, cacheKeys, namespaceFor } from "../packages/amc-mcp/src/store";

/**
 * The offline layer exists to keep one promise: a dropped connection degrades
 * what an agent can *read* but never loses what it *writes*. These tests hold
 * it to that, and to the equally important converse — that a real server error
 * (a revoked key, a 500) is never disguised as "you're offline", because
 * serving a cached copy there would hide a broken deployment behind stale data.
 */

const config = {
  baseUrl: "https://amc.test",
  apiKey: "amc_test_key",
  requestTimeoutMs: 1_000,
  cacheDir: "",
  offlineEnabled: true,
};

let root: string;
let store: OfflineStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "amc-offline-"));
  store = new OfflineStore(root, "ns");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A fetch that fails at the transport layer — the definition of "offline". */
function stubOffline() {
  const spy = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * A fetch returning a real HTTP response. The parameters are declared so
 * `spy.mock.calls` stays typed as [url, init] rather than an empty tuple.
 */
function stubResponse(body: unknown, status = 200) {
  const spy = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function offlineClient(enabled = true) {
  return new OfflineClient(new AmcClient(config), store, enabled, () => {});
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("OfflineStore", () => {
  it("round-trips a cached payload with its timestamp", () => {
    store.write("k", { hello: "world" });
    const hit = store.read<{ hello: string }>("k");

    expect(hit?.data).toEqual({ hello: "world" });
    expect(hit?.cachedAt).toBeGreaterThan(0);
  });

  it("returns null for a key that was never written", () => {
    expect(store.read("missing")).toBeNull();
  });

  it("discards a corrupt entry instead of failing every future read", () => {
    store.write("k", { a: 1 });
    // Simulate a write truncated by a kill: overwrite with invalid JSON.
    const file = fs
      .readdirSync(path.join(root, "ns", "cache"))
      .map((n) => path.join(root, "ns", "cache", n))[0];
    fs.writeFileSync(file, "{not json");

    expect(store.read("k")).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("keeps different credentials in separate namespaces", () => {
    const a = namespaceFor("https://amc.test", "key-a");
    const b = namespaceFor("https://amc.test", "key-b");
    const sameUrlDifferentKey = namespaceFor("https://other.test", "key-a");

    expect(a).not.toBe(b);
    expect(a).not.toBe(sameUrlDifferentKey);
    // Stable across calls, or yesterday's cache would be unreachable.
    expect(a).toBe(namespaceFor("https://amc.test", "key-a"));
    // The key must not be recoverable from the directory name.
    expect(a).not.toContain("key-a");
  });

  it("never lets a slug containing path separators escape the cache dir", () => {
    store.write(cacheKeys.memories("../../evil"), [{ id: "x" }]);

    const files = fs.readdirSync(path.join(root, "ns", "cache"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.json$/);
  });

  it("replays queued writes oldest-first regardless of filesystem order", () => {
    const first = store.enqueue("save", { title: "first" });
    // Force a distinguishable ordering rather than relying on clock resolution.
    const second = store.enqueue("save", { title: "second" });
    const file = path.join(root, "ns", "outbox", `${second.id}.json`);
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    entry.queuedAt = first.queuedAt + 1000;
    fs.writeFileSync(file, JSON.stringify(entry));

    expect(store.pending().map((e) => e.payload.title)).toEqual(["first", "second"]);
    expect(store.pendingCount()).toBe(2);
  });

  it("forgets a queued write once it is resolved", () => {
    const entry = store.enqueue("save", { title: "t" });
    store.resolve(entry.id);

    expect(store.pendingCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("reads while offline", () => {
  it("serves the last successful response when the API is unreachable", async () => {
    stubResponse({ projects: [{ id: "1", name: "App", slug: "app" }] });
    const online = await offlineClient().listProjects();
    expect(online.cachedAt).toBeNull();

    stubOffline();
    const offline = await offlineClient().listProjects();

    expect(offline.data).toEqual([{ id: "1", name: "App", slug: "app" }]);
    expect(offline.cachedAt).toBeGreaterThan(0);
  });

  it("caches the project context so an agent can start a task offline", async () => {
    stubResponse({ context: "# Decisions\nUse Postgres." });
    await offlineClient().getProjectContext("app");

    stubOffline();
    const { data, cachedAt } = await offlineClient().getProjectContext("app");

    expect(data).toContain("Use Postgres.");
    expect(cachedAt).toBeGreaterThan(0);
  });

  /**
   * The documented workflow is `get_project_context` then `search_memory`, and
   * neither writes the `list_memories` cache — which was the only pool the
   * offline keyword scan looked at, so search failed outright the first time a
   * connection dropped. Anything the cache has seen must be searchable.
   */
  it("keyword-searches offline over memories seen through search alone", async () => {
    stubResponse({
      results: [
        {
          id: "m1",
          title: "Money is integer minor units",
          content: "Never floats for money.",
          category: "CodingStandard",
          importance: 5,
        },
      ],
    });
    const online = offlineClient();
    await online.searchMemory("app", "currency");

    stubOffline();
    const { data, cachedAt, degraded } = await offlineClient().searchMemory("app", "money");

    expect(degraded).toBe(true);
    expect(cachedAt).toBeGreaterThan(0);
    expect(data.map((m) => m.title)).toEqual(["Money is integer minor units"]);
  });

  it("keeps a deleted memory out of later offline searches", async () => {
    stubResponse({
      results: [{ id: "m1", title: "Doomed", content: "About to go.", category: "General", importance: 3 }],
    });
    await offlineClient().searchMemory("app", "doomed");

    stubResponse({ projects: [{ id: "p1", name: "App", slug: "app", memoryCount: 1 }] });
    const client = offlineClient();
    await client.listProjects();
    stubResponse(null, 204);
    await client.deleteMemory("m1");

    stubOffline();
    await expect(offlineClient().searchMemory("app", "doomed")).resolves.toMatchObject({
      data: [],
    });
  });

  it("fails rather than inventing data when nothing was ever cached", async () => {
    stubOffline();
    await expect(offlineClient().listProjects()).rejects.toThrow(/Could not reach/);
  });

  it("surfaces a revoked key instead of hiding it behind cached data", async () => {
    stubResponse({ projects: [{ id: "1", name: "App", slug: "app" }] });
    await offlineClient().listProjects();

    // The server answered — that is not an offline condition, and quietly
    // serving the cache here would make a dead API key look like a live one.
    stubResponse({ error: "Invalid API key" }, 401);
    await expect(offlineClient().listProjects()).rejects.toThrow(/Authentication failed/);
  });

  it("surfaces a server error rather than masking it with a cached copy", async () => {
    stubResponse({ projects: [] });
    await offlineClient().listProjects();

    stubResponse({ error: "boom" }, 500);
    await expect(offlineClient().listProjects()).rejects.toThrow(/server error/);
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe("saving while offline", () => {
  const memory = {
    projectSlug: "app",
    title: "Use pgvector",
    content: "Cosine distance on 384-d vectors.",
    category: "TechnicalDecision",
    importance: 5,
  };

  it("queues the memory instead of losing it", async () => {
    stubOffline();
    const outcome = await offlineClient().saveMemory(memory);

    expect(outcome.status).toBe("queued");
    expect(outcome.localId).toMatch(/^local:/);
    expect(outcome.pending).toBe(1);
    expect(store.pending()[0].payload.title).toBe("Use pgvector");
  });

  it("shows a just-queued memory in the same offline session", async () => {
    stubOffline();
    const client = offlineClient();
    await client.saveMemory(memory);

    const { data } = await client.searchMemory("app", "pgvector");
    expect(data.map((m) => m.title)).toContain("Use pgvector");
  });

  it("replays the queue in order once the server is reachable again", async () => {
    stubOffline();
    const offline = offlineClient();
    await offline.saveMemory({ ...memory, title: "First" });
    await offline.saveMemory({ ...memory, title: "Second" });
    expect(store.pendingCount()).toBe(2);

    const spy = stubResponse({ memory: { id: "srv", title: "ok" } });
    await offlineClient().flush();

    expect(store.pendingCount()).toBe(0);
    const titles = spy.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)).title as string,
    );
    expect(titles).toEqual(["First", "Second"]);
  });

  it("syncs the backlog automatically on the next successful call", async () => {
    stubOffline();
    await offlineClient().saveMemory(memory);

    stubResponse({ projects: [] });
    await offlineClient().listProjects();

    expect(store.pendingCount()).toBe(0);
  });

  /**
   * The bug this prevents: one memory saved offline arrived on the server
   * twice. Start-up drains the backlog, the agent's first tool call flushes
   * too, and both read the same entry off disk before either had finished
   * sending it — the entry was only deleted after its POST returned.
   */
  it("sends a queued write once when two flushes race", async () => {
    stubOffline();
    await offlineClient().saveMemory(memory);

    let inFlight = 0;
    let overlapped = false;
    const spy = vi.fn(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return new Response(JSON.stringify({ memory: { id: "srv" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    const client = offlineClient();
    await Promise.all([client.flush(), client.flush()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(overlapped).toBe(false);
    expect(store.pendingCount()).toBe(0);
  });

  /**
   * Same hazard, one level out: two agents pointed at the same account share a
   * cache directory, so the guard cannot live in a single process's memory.
   */
  it("sends a queued write once when two separate runners flush together", async () => {
    stubOffline();
    await offlineClient().saveMemory(memory);

    const spy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ memory: { id: "srv" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    const one = new OfflineClient(new AmcClient(config), new OfflineStore(root, "ns"), true, () => {});
    const two = new OfflineClient(new AmcClient(config), new OfflineStore(root, "ns"), true, () => {});
    await Promise.all([one.flush(), two.flush()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.pendingCount()).toBe(0);
  });

  /** A claim must not swallow the write when the replay never lands. */
  it("returns a claimed write to the queue when the replay fails offline", async () => {
    stubOffline();
    await offlineClient().saveMemory(memory);

    await offlineClient().flush();

    expect(store.pendingCount()).toBe(1);
    expect(store.pending()).toHaveLength(1);
  });

  it("leaves the queue intact when the connection drops again mid-flush", async () => {
    stubOffline();
    const offline = offlineClient();
    await offline.saveMemory({ ...memory, title: "First" });
    await offline.saveMemory({ ...memory, title: "Second" });

    // First replay succeeds, then the network disappears again.
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return new Response(JSON.stringify({ memory: { id: "1" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new TypeError("fetch failed");
      }),
    );

    const result = await offlineClient().flush();

    expect(result.synced).toBe(1);
    expect(store.pendingCount()).toBe(1);
    expect(store.pending()[0].payload.title).toBe("Second");
  });

  it("drops a write the server rejects so it cannot block the queue forever", async () => {
    stubOffline();
    await offlineClient().saveMemory(memory);

    // The project was deleted while the agent was offline.
    stubResponse({ error: "No such project" }, 404);
    const result = await offlineClient().flush();

    expect(result.failed).toBe(1);
    expect(store.pendingCount()).toBe(0);
  });

  it("discards a queued save rather than queueing a delete the server can't apply", async () => {
    stubOffline();
    const client = offlineClient();
    const saved = await client.saveMemory(memory);

    const outcome = await client.deleteMemory(saved.localId!);

    expect(outcome.status).toBe("unqueued");
    expect(store.pendingCount()).toBe(0);
  });

  it("queues a delete of a synced memory for replay", async () => {
    stubOffline();
    const outcome = await offlineClient().deleteMemory("server-id");

    expect(outcome.status).toBe("queued");
    expect(store.pending()[0]).toMatchObject({
      kind: "delete",
      payload: { memoryId: "server-id" },
    });
  });

  it("treats an already-deleted memory as a successful replay", async () => {
    stubOffline();
    await offlineClient().deleteMemory("gone");

    stubResponse({ error: "Not found" }, 404);
    const result = await offlineClient().flush();

    // The queue wanted the memory gone, and it is gone: synced, not failed.
    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(store.pendingCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Opt-out
// ---------------------------------------------------------------------------

describe("AMC_OFFLINE=0", () => {
  it("neither caches reads nor queues writes", async () => {
    stubResponse({ projects: [{ id: "1", name: "App", slug: "app" }] });
    await offlineClient(false).listProjects();

    stubOffline();
    await expect(offlineClient(false).listProjects()).rejects.toThrow(/Could not reach/);
    await expect(
      offlineClient(false).saveMemory({ projectSlug: "app", title: "t", content: "c" }),
    ).rejects.toThrow(/Could not reach/);
    expect(store.pendingCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Offline search
// ---------------------------------------------------------------------------

describe("keywordSearch", () => {
  const memories = [
    { id: "1", title: "Auth uses Supabase", content: "Sessions are cookie-based." },
    { id: "2", title: "Database choice", content: "Postgres with pgvector for search." },
    { id: "3", title: "Styling", content: "Tailwind, no CSS modules." },
  ];

  it("ranks a title match above a body match", () => {
    const results = keywordSearch(memories, "database", 10);
    expect(results[0].id).toBe("2");
  });

  it("finds memories by a term that only appears in the body", () => {
    expect(keywordSearch(memories, "pgvector", 10).map((m) => m.id)).toEqual(["2"]);
  });

  it("returns nothing rather than everything when no term matches", () => {
    expect(keywordSearch(memories, "kubernetes", 10)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(keywordSearch(memories, "a", 1).length).toBeLessThanOrEqual(1);
  });

  it("breaks ties toward the memory marked more important", () => {
    const tied = [
      { id: "low", title: "Cache policy", content: "x", importance: 1 },
      { id: "high", title: "Cache policy", content: "x", importance: 5 },
    ];
    expect(keywordSearch(tied, "cache policy", 10)[0].id).toBe("high");
  });
});
