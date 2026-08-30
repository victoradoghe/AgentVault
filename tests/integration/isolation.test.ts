import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotFoundError } from "@/server/errors";
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  updateMemory,
} from "@/server/memories";
import {
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjects,
  requireOwnedProject,
} from "@/server/projects";
import { getProjectContext, searchMemories } from "@/server/search";

import { createTestUser, destroyTestUser, unknownUuid, type TestUser } from "./helpers";

/**
 * Cross-user isolation — the property the whole product rests on.
 *
 * AgentVault is a multi-tenant store of the most sensitive thing a team writes
 * down: how their codebase actually works. Every service function is supposed to
 * be scoped to the acting `userId`, and today every one of them is. Nothing
 * structurally enforces that, though — a refactor that drops one `where` clause
 * compiles, passes the unit suite, and silently serves one customer's
 * architecture notes to another.
 *
 * So this suite is deliberately exhaustive rather than representative: it walks
 * every exported read and write with a second user's id and demands a
 * `NotFoundError`. A new service function added without ownership scoping should
 * stand out here as a missing sibling case.
 *
 * 404 rather than 403 throughout, on purpose: a 403 would confirm that some
 * other user's project exists, which is itself a leak (see server/errors.ts).
 */

let alice: TestUser;
let bob: TestUser;

/** Alice's project and memories. Bob must not be able to touch any of them. */
let aliceProjectId: string;
let aliceProjectSlug: string;
let aliceMemoryId: string;

const ALICE_MEMORY_TITLE = "Money is always integer minor units";
const CURRENCY_QUERY = "how should we represent currency amounts?";

beforeAll(async () => {
  alice = await createTestUser("alice");
  bob = await createTestUser("bob");

  const project = await createProject({ userId: alice.id, name: "Alice Ledger Service" });
  aliceProjectId = project.id;
  aliceProjectSlug = project.slug;

  const memory = await createMemory({
    userId: alice.id,
    projectId: aliceProjectId,
    title: ALICE_MEMORY_TITLE,
    content:
      "Never use floats for money. Every amount is an integer number of cents " +
      "with an explicit ISO-4217 currency code.",
    category: "CodingStandard",
    importance: 5,
  });
  aliceMemoryId = memory.id;

  // Bob gets his own project so he is a real user with real data, not just an id
  // with nothing behind it — that is the case where a missing scope shows.
  await createProject({ userId: bob.id, name: "Bob Unrelated Project" });
});

afterAll(async () => {
  await destroyTestUser(alice);
  await destroyTestUser(bob);
});

describe("project reads are scoped to the owner", () => {
  it("does not list another user's projects", async () => {
    const projects = await listProjects(bob.id);
    expect(projects.map((p) => p.id)).not.toContain(aliceProjectId);
  });

  it("lists the owner's own project", async () => {
    const projects = await listProjects(alice.id);
    expect(projects.map((p) => p.id)).toContain(aliceProjectId);
  });

  it("refuses a lookup by another user's slug", async () => {
    // Slugs are per-user and derived from the project name, so they are the most
    // guessable handle in the system — the likeliest way a scoping bug would
    // actually be reached.
    await expect(getProjectBySlug(bob.id, aliceProjectSlug)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses an ownership assertion for another user's project id", async () => {
    await expect(requireOwnedProject(bob.id, aliceProjectId)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("memory reads are scoped to the owner", () => {
  it("refuses to list another user's project memories", async () => {
    await expect(
      listMemories({ userId: bob.id, projectId: aliceProjectId }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to fetch another user's memory by id", async () => {
    await expect(getMemory(bob.id, aliceMemoryId)).rejects.toThrow(NotFoundError);
  });

  it("lets the owner fetch their own memory", async () => {
    const memory = await getMemory(alice.id, aliceMemoryId);
    expect(memory.title).toBe(ALICE_MEMORY_TITLE);
  });
});

describe("search and context are scoped to the owner", () => {
  it("refuses to search another user's project", async () => {
    await expect(
      searchMemories({
        userId: bob.id,
        projectId: aliceProjectId,
        query: CURRENCY_QUERY,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to build a context package for another user's project", async () => {
    // The highest-value target in the system: one call that returns a project's
    // defining knowledge as ready-to-read markdown.
    await expect(
      getProjectContext({ userId: bob.id, projectId: aliceProjectId }),
    ).rejects.toThrow(NotFoundError);
  });

  it("still returns the owner's own results", async () => {
    const results = await searchMemories({
      userId: alice.id,
      projectId: aliceProjectId,
      query: CURRENCY_QUERY,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe(ALICE_MEMORY_TITLE);
  });

  it("never returns another user's memories in the owner's own search", async () => {
    // The SQL join on projects.user_id is the second layer of enforcement, below
    // requireOwnedProject. Only a query that WOULD rank a foreign row highly can
    // catch that layer failing, so Bob's memory is near-identical text.
    const bobProject = await createProject({ userId: bob.id, name: "Bob Ledger Service" });
    const foreignTitle = "Bob's private currency rule";
    await createMemory({
      userId: bob.id,
      projectId: bobProject.id,
      title: foreignTitle,
      content:
        "Never use floats for money. Every amount is an integer number of cents " +
        "with an explicit ISO-4217 currency code.",
      category: "CodingStandard",
      importance: 5,
    });

    const results = await searchMemories({
      userId: alice.id,
      projectId: aliceProjectId,
      query: CURRENCY_QUERY,
    });

    expect(results.every((r) => r.title !== foreignTitle)).toBe(true);
  });
});

describe("writes are scoped to the owner", () => {
  it("refuses to create a memory in another user's project", async () => {
    await expect(
      createMemory({
        userId: bob.id,
        projectId: aliceProjectId,
        title: "Injected by Bob",
        content: "This memory must never be written into Alice's project.",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to update another user's memory", async () => {
    await expect(
      updateMemory({ userId: bob.id, memoryId: aliceMemoryId, title: "Rewritten by Bob" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses to delete another user's memory", async () => {
    await expect(deleteMemory(bob.id, aliceMemoryId)).rejects.toThrow(NotFoundError);
  });

  it("refuses to delete another user's project", async () => {
    await expect(deleteProject(bob.id, aliceProjectId)).rejects.toThrow(NotFoundError);
  });

  it("leaves the target untouched after every rejected write", async () => {
    // The rejections above must be refusals, not partial writes that happened to
    // throw on the way out.
    const memory = await getMemory(alice.id, aliceMemoryId);
    expect(memory.title).toBe(ALICE_MEMORY_TITLE);

    const memories = await listMemories({ userId: alice.id, projectId: aliceProjectId });
    expect(memories).toHaveLength(1);

    const project = await getProjectBySlug(alice.id, aliceProjectSlug);
    expect(project.id).toBe(aliceProjectId);
  });
});

describe("unknown ids are not found rather than errors", () => {
  it("treats a well-formed but unknown project id as not found", async () => {
    await expect(requireOwnedProject(alice.id, unknownUuid())).rejects.toThrow(
      NotFoundError,
    );
  });

  it("treats a well-formed but unknown memory id as not found", async () => {
    await expect(getMemory(alice.id, unknownUuid())).rejects.toThrow(NotFoundError);
  });
});
