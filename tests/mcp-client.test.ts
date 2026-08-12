import { afterEach, describe, expect, it, vi } from "vitest";

import { AmcClient, AmcError } from "../packages/amc-mcp/src/client";

/**
 * The MCP client is the seam between an agent and the REST API. Two things
 * matter: it must unwrap the API's response envelopes correctly (a silent
 * mis-unwrap looks like "the agent has no memories"), and it must turn HTTP
 * failures into messages that tell the user what to actually do.
 */

const config = { baseUrl: "https://amc.test", apiKey: "amc_test_key" };

function client() {
  return new AmcClient(config);
}

/** Stub `fetch` with a single canned response. */
function stubFetch(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
) {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? "application/json";
  const text = typeof body === "string" ? body : JSON.stringify(body);

  // The parameters are declared so `spy.mock.calls` stays typed as
  // [url, init] rather than an empty tuple.
  const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(status === 204 ? null : text, {
      status,
      headers: { "content-type": contentType },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request construction", () => {
  it("sends the API key as a Bearer token against the configured base URL", async () => {
    const spy = stubFetch({ projects: [] });
    await client().listProjects();

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://amc.test/api/projects");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer amc_test_key",
    );
  });

  it("url-encodes project slugs and memory ids", async () => {
    const spy = stubFetch({ memories: [] });
    await client().listMemories("my project/../etc");

    expect(spy.mock.calls[0][0]).toBe(
      "https://amc.test/api/projects/my%20project%2F..%2Fetc/memories",
    );
  });

  it("asks for markdown when fetching context", async () => {
    const spy = stubFetch("# Project Context", { contentType: "text/markdown" });
    await client().getProjectContext("amc-web");

    const init = spy.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Accept).toContain("text/markdown");
  });

  it("passes the search query and limit as query parameters", async () => {
    const spy = stubFetch({ results: [] });
    await client().searchMemory("amc-web", "how do we handle money?", 5);

    const url = spy.mock.calls[0][0];
    expect(url).toContain("/api/projects/amc-web/search?");
    expect(url).toContain("query=how+do+we+handle+money%3F");
    expect(url).toContain("limit=5");
  });

  it("omits the limit when it is not supplied", async () => {
    const spy = stubFetch({ results: [] });
    await client().searchMemory("amc-web", "q");

    expect(spy.mock.calls[0][0]).not.toContain("limit=");
  });

  it("omits the category filter when it is not supplied", async () => {
    const spy = stubFetch({ memories: [] });
    await client().listMemories("amc-web");

    expect(spy.mock.calls[0][0]).toBe("https://amc.test/api/projects/amc-web/memories");
  });

  it("sends a JSON body when saving a memory", async () => {
    const spy = stubFetch({ memory: { id: "m1", title: "t", content: "c" } });
    await client().saveMemory({
      projectSlug: "amc-web",
      title: "t",
      content: "c",
      category: "Architecture",
      importance: 5,
    });

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://amc.test/api/projects/amc-web/memories");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      title: "t",
      content: "c",
      category: "Architecture",
      importance: 5,
    });
    // The slug belongs in the path, never the payload.
    expect(init?.body as string).not.toContain("projectSlug");
  });
});

describe("response unwrapping", () => {
  it("unwraps the documented single-key envelopes", async () => {
    stubFetch({ projects: [{ id: "p1", name: "Web", slug: "web" }] });
    expect(await client().listProjects()).toHaveLength(1);

    stubFetch({ results: [{ id: "m1", title: "t", content: "c", score: 0.9 }] });
    expect((await client().searchMemory("web", "q"))[0].score).toBe(0.9);

    stubFetch({ memories: [{ id: "m1", title: "t", content: "c" }] });
    expect(await client().listMemories("web")).toHaveLength(1);

    stubFetch({ memory: { id: "m1", title: "t", content: "c" } });
    expect((await client().saveMemory({ projectSlug: "web", title: "t", content: "c" })).id).toBe(
      "m1",
    );
  });

  it("accepts a bare array or a generic { data } wrapper", async () => {
    stubFetch([{ id: "p1", name: "Web", slug: "web" }]);
    expect(await client().listProjects()).toHaveLength(1);

    stubFetch({ data: [{ id: "p1", name: "Web", slug: "web" }] });
    expect(await client().listProjects()).toHaveLength(1);
  });

  it("returns an empty list rather than throwing on an unrecognised shape", async () => {
    stubFetch({ unexpected: "shape" });
    expect(await client().listProjects()).toEqual([]);
  });

  it("returns raw markdown context as a string", async () => {
    stubFetch("# Project Context: web\n\n## Architecture", { contentType: "text/markdown" });

    expect(await client().getProjectContext("web")).toContain("# Project Context: web");
  });

  it("pulls context out of a JSON envelope when the server returns JSON", async () => {
    stubFetch({ markdown: "# From JSON" });
    expect(await client().getProjectContext("web")).toBe("# From JSON");

    stubFetch({ context: "# Context key" });
    expect(await client().getProjectContext("web")).toBe("# Context key");
  });

  it("handles a 204 with no body", async () => {
    stubFetch(null, { status: 204 });

    await expect(client().deleteMemory("m1")).resolves.toBeUndefined();
  });
});

describe("error mapping", () => {
  it("explains an auth failure and marks it non-retriable", async () => {
    stubFetch({ error: "Invalid API key" }, { status: 401 });

    const err = await client().listProjects().catch((e: AmcError) => e);
    expect(err).toBeInstanceOf(AmcError);
    expect((err as AmcError).status).toBe(401);
    expect((err as AmcError).retriable).toBe(false);
    expect((err as AmcError).message).toContain("AMC_API_KEY");
    expect((err as AmcError).message).toContain("Invalid API key");
  });

  it("treats 403 like 401", async () => {
    stubFetch({ error: "Forbidden" }, { status: 403 });

    const err = (await client().listProjects().catch((e) => e)) as AmcError;
    expect(err.retriable).toBe(false);
    expect(err.status).toBe(403);
  });

  it("explains a 404 as an unknown slug or id", async () => {
    stubFetch({ error: "Project not found" }, { status: 404 });

    const err = (await client().listMemories("nope").catch((e) => e)) as AmcError;
    expect(err.message).toContain("project slug or memory id");
    expect(err.retriable).toBe(false);
  });

  it("marks rate limiting and server errors as retriable", async () => {
    stubFetch({ error: "slow down" }, { status: 429 });
    expect(((await client().listProjects().catch((e) => e)) as AmcError).retriable).toBe(true);

    stubFetch({ error: "boom" }, { status: 503 });
    expect(((await client().listProjects().catch((e) => e)) as AmcError).retriable).toBe(true);
  });

  it("reports a network failure as retriable with the base URL in the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const err = (await client().listProjects().catch((e) => e)) as AmcError;
    expect(err.retriable).toBe(true);
    expect(err.message).toContain("https://amc.test");
    expect(err.message).toContain("AMC_BASE_URL");
  });

  it("falls back to a plain message when the error body is not JSON", async () => {
    stubFetch("upstream exploded", { status: 500, contentType: "text/plain" });

    const err = (await client().listProjects().catch((e) => e)) as AmcError;
    expect(err.message).toContain("upstream exploded");
  });
});
