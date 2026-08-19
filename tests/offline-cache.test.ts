import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cacheKeys,
  clearCache,
  namespaceFor,
  readCache,
  writeCache,
} from "@/lib/offline/cache";

/**
 * The offline cache decides what a user sees when the server can't be reached,
 * so the tests that matter are the ones about *whose* data comes back and what
 * happens when storage misbehaves. A namespace collision here would show one
 * account another's memories on a shared machine.
 *
 * `localStorage` doesn't exist under the node test environment, so a minimal
 * in-memory stand-in is installed on `globalThis.window` — the module only ever
 * touches `getItem`/`setItem`/`removeItem`/`key`/`length`.
 */

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  /** Set to make every write throw, standing in for an exhausted quota. */
  full = false;

  get length() {
    return this.map.size;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("namespaceFor", () => {
  it("is stable for the same identity", () => {
    expect(namespaceFor("dev@example.com")).toBe(namespaceFor("dev@example.com"));
  });

  it("ignores case and surrounding whitespace, as sign-in does", () => {
    expect(namespaceFor("  Dev@Example.COM ")).toBe(namespaceFor("dev@example.com"));
  });

  it("separates different accounts", () => {
    expect(namespaceFor("a@example.com")).not.toBe(namespaceFor("b@example.com"));
  });

  it("does not put the raw email in the key", () => {
    expect(namespaceFor("dev@example.com")).not.toContain("dev@example.com");
  });

  it("has a defined namespace for no identity at all", () => {
    expect(namespaceFor(null)).toBe("anon");
    expect(namespaceFor(undefined)).toBe("anon");
  });
});

describe("readCache / writeCache", () => {
  it("round-trips a payload", () => {
    writeCache("ns", cacheKeys.projects(), [{ id: "1", name: "my-app" }]);

    expect(readCache("ns", cacheKeys.projects())?.data).toEqual([
      { id: "1", name: "my-app" },
    ]);
  });

  it("records when the entry was written", () => {
    const before = Date.now();
    writeCache("ns", "k", "value");

    const entry = readCache<string>("ns", "k");
    expect(entry?.cachedAt).toBeGreaterThanOrEqual(before);
    expect(entry?.cachedAt).toBeLessThanOrEqual(Date.now());
  });

  it("returns null for a key that was never written", () => {
    expect(readCache("ns", "missing")).toBeNull();
  });

  it("never serves one namespace's entry to another", () => {
    const alice = namespaceFor("alice@example.com");
    const bob = namespaceFor("bob@example.com");
    writeCache(alice, cacheKeys.projects(), ["alice-secret-project"]);

    expect(readCache(bob, cacheKeys.projects())).toBeNull();
  });

  it("keys memories separately per project and category filter", () => {
    expect(cacheKeys.memories("app", "Architecture")).not.toBe(
      cacheKeys.memories("app", "Conventions"),
    );
    expect(cacheKeys.memories("app")).not.toBe(cacheKeys.memories("other"));
  });

  it("drops a corrupt entry instead of throwing on every future read", () => {
    writeCache("ns", "k", "value");
    // Simulate a half-written or hand-edited value.
    storage.setItem(storage.key(0)!, "{not json");

    expect(readCache("ns", "k")).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("ignores entries written by an older cache version", () => {
    writeCache("ns", "k", "value");
    const key = storage.key(0)!;
    storage.setItem(key, JSON.stringify({ v: 0, cachedAt: Date.now(), data: "old" }));

    expect(readCache("ns", "k")).toBeNull();
  });

  it("survives a full quota rather than breaking the page", () => {
    storage.full = true;

    expect(() => writeCache("ns", "k", "value")).not.toThrow();
    expect(readCache("ns", "k")).toBeNull();
  });

  it("returns null everywhere when storage is unavailable", () => {
    delete (globalThis as { window?: unknown }).window;

    expect(() => writeCache("ns", "k", "value")).not.toThrow();
    expect(readCache("ns", "k")).toBeNull();
  });
});

describe("clearCache", () => {
  it("removes every namespace's entries — sign-out must leave nothing", () => {
    writeCache(namespaceFor("alice@example.com"), cacheKeys.projects(), ["a"]);
    writeCache(namespaceFor("bob@example.com"), cacheKeys.memories("app"), ["b"]);

    clearCache();

    expect(storage.length).toBe(0);
  });

  it("leaves unrelated localStorage keys alone", () => {
    storage.setItem("amc_local_user", '{"email":"dev@example.com"}');
    storage.setItem("theme", "dark");
    writeCache("ns", "k", "value");

    clearCache();

    expect(storage.getItem("theme")).toBe("dark");
    expect(storage.getItem("amc_local_user")).not.toBeNull();
  });
});
