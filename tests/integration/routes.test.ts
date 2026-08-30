import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route handlers reach for the request-scoped cookie store when there is no
// Bearer token. Under Vitest there is no request scope, so stub it as "no
// cookies present" — which is exactly the unauthenticated case these tests want.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { resetAllRateLimits } from "@/lib/api/rate-limit";
import { createMemory } from "@/server/memories";
import { createProject } from "@/server/projects";

import * as keysRoute from "@/app/api/keys/route";
import * as memoryRoute from "@/app/api/memories/[id]/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[slug]/route";
import * as contextRoute from "@/app/api/projects/[slug]/context/route";
import * as memoriesRoute from "@/app/api/projects/[slug]/memories/route";
import * as searchRoute from "@/app/api/projects/[slug]/search/route";

import { createTestUser, destroyTestUser, type TestUser } from "./helpers";

/**
 * The HTTP layer, driven as a real agent drives it: Bearer API keys against the
 * exported route handlers.
 *
 * `isolation.test.ts` proves the service layer is scoped. This proves the routes
 * actually reach that layer with the caller's own id — a route that passed a
 * slug straight through, or looked a project up before authenticating, would
 * pass every service-layer test and still leak.
 *
 * Every case here is expressed as a status code, because that is the contract
 * the MCP client and any other consumer depend on.
 */

let alice: TestUser;
let bob: TestUser;

let aliceProjectSlug: string;
let aliceMemoryId: string;

/** A request as an authenticated agent would send it. */
function asUser(user: TestUser, url: string, init: RequestInit = {}): Request {
  return new Request(`https://agentvault.test${url}`, {
    ...init,
    headers: { authorization: `Bearer ${user.apiKey}`, ...(init.headers ?? {}) },
  });
}

/** A request with no credentials at all. */
function anonymous(url: string, init: RequestInit = {}): Request {
  return new Request(`https://agentvault.test${url}`, init);
}

/** Next passes dynamic segments as a promise; mirror that exactly. */
function params<T extends object>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

beforeAll(async () => {
  // Force local auth mode so the unauthenticated path resolves through the
  // (stubbed) cookie store rather than reaching for a Supabase project. The
  // Bearer path never touches either, but the 401 cases do.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

  alice = await createTestUser("routes-alice");
  bob = await createTestUser("routes-bob");

  const project = await createProject({ userId: alice.id, name: "Alice Payments API" });
  aliceProjectSlug = project.slug;

  const memory = await createMemory({
    userId: alice.id,
    projectId: project.id,
    title: "Idempotency keys on every write",
    content: "Every mutating payments endpoint requires an Idempotency-Key header.",
    category: "Architecture",
    importance: 5,
  });
  aliceMemoryId = memory.id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await destroyTestUser(alice);
  await destroyTestUser(bob);
});

beforeEach(() => {
  // Limiter state is module-global and would otherwise leak between cases.
  resetAllRateLimits();
});

describe("authentication", () => {
  it("rejects a request with no credentials", async () => {
    const res = await projectsRoute.GET(anonymous("/api/projects"));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown Bearer key", async () => {
    const res = await projectsRoute.GET(
      new Request("https://agentvault.test/api/projects", {
        headers: { authorization: `Bearer amc_${"a".repeat(43)}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const res = await projectsRoute.GET(
      new Request("https://agentvault.test/api/projects", {
        headers: { authorization: alice.apiKey },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a valid Bearer key", async () => {
    const res = await projectsRoute.GET(asUser(alice, "/api/projects"));
    expect(res.status).toBe(200);
  });
});

describe("a project is invisible to everyone but its owner", () => {
  it("lists only the caller's projects", async () => {
    const res = await projectsRoute.GET(asUser(bob, "/api/projects"));
    const body = await res.json();
    expect(body.projects.every((p: { slug: string }) => p.slug !== aliceProjectSlug)).toBe(
      true,
    );
  });

  it("404s a foreign project's memories", async () => {
    const res = await memoriesRoute.GET(
      asUser(bob, `/api/projects/${aliceProjectSlug}/memories`),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a foreign project's search", async () => {
    const res = await searchRoute.GET(
      asUser(bob, `/api/projects/${aliceProjectSlug}/search?query=idempotency`),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a foreign project's context package", async () => {
    const res = await contextRoute.GET(
      asUser(bob, `/api/projects/${aliceProjectSlug}/context`),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a write into a foreign project", async () => {
    const res = await memoriesRoute.POST(
      asUser(bob, `/api/projects/${aliceProjectSlug}/memories`, {
        method: "POST",
        body: JSON.stringify({ title: "Injected", content: "Should never land." }),
      }),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a delete of a foreign project", async () => {
    const res = await projectRoute.DELETE(
      asUser(bob, `/api/projects/${aliceProjectSlug}`, { method: "DELETE" }),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(404);
  });

  it("still serves the owner", async () => {
    // The mirror image of every case above: the same routes, the right user.
    const res = await contextRoute.GET(
      asUser(alice, `/api/projects/${aliceProjectSlug}/context`),
      params({ slug: aliceProjectSlug }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("Idempotency");
  });
});

describe("a memory is invisible to everyone but its owner", () => {
  it("404s a foreign memory read", async () => {
    const res = await memoryRoute.GET(
      asUser(bob, `/api/memories/${aliceMemoryId}`),
      params({ id: aliceMemoryId }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a foreign memory update", async () => {
    const res = await memoryRoute.PATCH(
      asUser(bob, `/api/memories/${aliceMemoryId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Rewritten by Bob" }),
      }),
      params({ id: aliceMemoryId }),
    );
    expect(res.status).toBe(404);
  });

  it("404s a foreign memory delete", async () => {
    const res = await memoryRoute.DELETE(
      asUser(bob, `/api/memories/${aliceMemoryId}`, { method: "DELETE" }),
      params({ id: aliceMemoryId }),
    );
    expect(res.status).toBe(404);
  });

  it("leaves the memory intact after the rejected writes", async () => {
    const res = await memoryRoute.GET(
      asUser(alice, `/api/memories/${aliceMemoryId}`),
      params({ id: aliceMemoryId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.title).toBe("Idempotency keys on every write");
  });
});

describe("API keys cannot manage API keys", () => {
  it("refuses to list keys for a Bearer-authenticated caller", async () => {
    // Session-only by design: a leaked key must not be able to mint a
    // replacement for itself or enumerate its siblings.
    const res = await keysRoute.GET(asUser(alice, "/api/keys"));
    expect(res.status).toBe(403);
  });

  it("refuses to mint a key for a Bearer-authenticated caller", async () => {
    const res = await keysRoute.POST(
      asUser(alice, "/api/keys", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("rate limiting", () => {
  /**
   * The limiter reads the wall clock, and spending a 30-request budget against a
   * distant database takes ~15 seconds of real time — long enough to cross a
   * 60-second window boundary and legitimately refill part of the budget
   * mid-test. Freezing `Date` (and only `Date` — timers stay real, so Prisma is
   * unaffected) makes the whole exchange happen at one instant, which is what
   * these tests actually mean to describe.
   */
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("429s once the embedding budget is spent, and only for that user", async () => {
    // One loop, three properties: each round trip here costs a real database
    // call, so exhausting the budget three separate times would add ~30 seconds
    // to the suite for nothing.
    //
    // The unknown slug is deliberate. The limit check runs BEFORE the project
    // lookup, so every allowed call is a cheap 404 — and that ordering is itself
    // worth pinning, since a limiter placed after the work protects nothing.
    const slug = "no-such-project";
    const call = (user: TestUser) =>
      searchRoute.GET(
        asUser(user, `/api/projects/${slug}/search?query=x`),
        params({ slug }),
      );

    const responses: Response[] = [];
    for (let i = 0; i < 31; i++) responses.push(await call(alice));

    // 1. Everything within budget is served.
    expect(responses.slice(0, 30).every((r) => r.status === 404)).toBe(true);

    // 2. The first request over it is refused, and says when to come back.
    const blocked = responses[30];
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);

    // 3. Bob's agent is not throttled by Alice's runaway loop — the budget is
    //    per user, which is the whole reason the key is the authenticated id.
    expect((await call(bob)).status).toBe(404);
  });

  it("throttles sign-in attempts by IP", async () => {
    const authRoute = await import("@/app/api/auth/local/route");

    const attempt = () =>
      authRoute.POST(
        new Request("https://agentvault.test/api/auth/local", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.42" },
          body: JSON.stringify({ email: "someone@example.test" }),
        }),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt()).status);

    // Whatever the endpoint decides about the credentials, the eleventh attempt
    // from one address must not get that far.
    expect(statuses[10]).toBe(429);
  });
});
