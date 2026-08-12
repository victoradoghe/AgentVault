import { describe, expect, it } from "vitest";

import {
  buildProjectContext,
  estimateTokens,
  getProjectContext,
  type ContextMemoryInput,
} from "@/server/context";
import type { MemoryCategory } from "@/lib/categories";

/**
 * The context package is what an agent actually injects into its prompt, so
 * these tests pin the three properties that matter: the right memories are
 * chosen, they are ordered priority-first, and the result never exceeds its
 * token budget.
 */

const FIXED_CLOCK = new Date("2026-01-01T00:00:00.000Z");

function memory(over: Partial<ContextMemoryInput> & { id: string }): ContextMemoryInput {
  return {
    title: `Memory ${over.id}`,
    content: "Some durable fact worth remembering.",
    category: "General" as MemoryCategory,
    importance: 3,
    updatedAt: FIXED_CLOCK,
    ...over,
  };
}

function build(memories: ContextMemoryInput[], options = {}) {
  return buildProjectContext(memories, {
    projectId: "test-project",
    generatedAt: FIXED_CLOCK,
    ...options,
  });
}

describe("estimateTokens", () => {
  it("estimates ~4 characters per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("buildProjectContext — selection", () => {
  it("returns an empty package with a placeholder note when there are no memories", () => {
    const ctx = build([]);

    expect(ctx.groups).toEqual([]);
    expect(ctx.counts).toEqual({ total: 0, included: 0, omitted: 0 });
    expect(ctx.markdown).toContain("_No memories available for this project yet._");
  });

  it("excludes memories that are not approved", () => {
    const ctx = build([
      memory({ id: "a", status: "approved" }),
      memory({ id: "b", status: "pending" }),
      memory({ id: "c", status: "rejected" }),
    ]);

    expect(ctx.counts.total).toBe(1);
    expect(ctx.counts.included).toBe(1);
    expect(ctx.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["a"]);
  });

  it("treats a missing status as approved", () => {
    const ctx = build([memory({ id: "a" })]);

    expect(ctx.counts.included).toBe(1);
  });

  it("includes low-importance memories in priority categories but not elsewhere", () => {
    const ctx = build([
      memory({ id: "arch", category: "Architecture", importance: 1 }),
      memory({ id: "note", category: "General", importance: 1 }),
    ]);

    const ids = ctx.groups.flatMap((g) => g.items).map((i) => i.id);
    expect(ids).toContain("arch");
    expect(ids).not.toContain("note");
  });

  it("honours a custom minOtherImportance threshold", () => {
    const memories = [
      memory({ id: "low", category: "Research", importance: 2 }),
      memory({ id: "high", category: "Research", importance: 4 }),
    ];

    expect(
      build(memories, { minOtherImportance: 1 })
        .groups.flatMap((g) => g.items)
        .map((i) => i.id)
        .sort(),
    ).toEqual(["high", "low"]);

    expect(
      build(memories, { minOtherImportance: 5 })
        .groups.flatMap((g) => g.items)
        .map((i) => i.id),
    ).toEqual([]);
  });

  it("counts omitted memories so the caller knows the package is partial", () => {
    const ctx = build(
      [
        memory({ id: "keep", category: "Architecture", importance: 5 }),
        memory({ id: "drop", category: "General", importance: 1 }),
      ],
      { minOtherImportance: 3 },
    );

    expect(ctx.counts).toEqual({ total: 2, included: 1, omitted: 1 });
  });
});

describe("buildProjectContext — ordering", () => {
  it("places priority-category groups before non-priority ones", () => {
    const ctx = build([
      memory({ id: "g", category: "General", importance: 5 }),
      memory({ id: "cs", category: "CodingStandard", importance: 1 }),
      memory({ id: "arch", category: "Architecture", importance: 1 }),
    ]);

    const categories = ctx.groups.map((g) => g.category);
    expect(categories).toEqual(["Architecture", "CodingStandard", "General"]);
    expect(ctx.groups.slice(0, 2).every((g) => g.priority)).toBe(true);
    expect(ctx.groups[2].priority).toBe(false);
  });

  it("orders items within a group by importance, then recency", () => {
    const ctx = build([
      memory({
        id: "older-high",
        category: "Architecture",
        importance: 5,
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      }),
      memory({
        id: "newer-high",
        category: "Architecture",
        importance: 5,
        updatedAt: new Date("2025-06-01T00:00:00.000Z"),
      }),
      memory({ id: "low", category: "Architecture", importance: 2 }),
    ]);

    expect(ctx.groups[0].items.map((i) => i.id)).toEqual([
      "newer-high",
      "older-high",
      "low",
    ]);
  });

  it("keeps priority memories when the budget only fits some of the pool", () => {
    const filler = "x".repeat(2000);
    const ctx = build(
      [
        memory({ id: "other", category: "Research", importance: 5, content: filler }),
        memory({ id: "priority", category: "Architecture", importance: 1, content: filler }),
      ],
      { tokenBudget: 600 },
    );

    // The priority pool is ranked ahead of everything else, so it wins the
    // budget even though the other memory is more important.
    expect(ctx.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["priority"]);
  });
});

describe("buildProjectContext — size limits", () => {
  it("truncates a single overlong memory and flags it", () => {
    const ctx = build(
      [memory({ id: "long", category: "Architecture", content: "word ".repeat(5000) })],
      { perItemTokenCap: 50 },
    );

    const item = ctx.groups[0].items[0];
    expect(item.truncated).toBe(true);
    expect(item.content.endsWith("…")).toBe(true);
    expect(estimateTokens(item.content)).toBeLessThanOrEqual(51);
  });

  it("does not flag content that fits under the per-item cap", () => {
    const ctx = build([memory({ id: "short", category: "Architecture", content: "brief" })]);

    expect(ctx.groups[0].items[0].truncated).toBe(false);
    expect(ctx.groups[0].items[0].content).toBe("brief");
  });

  it("never emits markdown that exceeds the token budget", () => {
    const memories = Array.from({ length: 200 }, (_, i) =>
      memory({
        id: `m${i}`,
        category: "Architecture",
        importance: 5,
        content: "A reasonably long durable fact about the system. ".repeat(10),
      }),
    );

    const ctx = build(memories, { tokenBudget: 1000 });

    expect(ctx.tokenEstimate).toBeLessThanOrEqual(1000);
    expect(ctx.counts.included).toBeGreaterThan(0);
    expect(ctx.counts.omitted).toBeGreaterThan(0);
  });

  it("still fits smaller items after skipping one that is too large", () => {
    const ctx = build(
      [
        memory({
          id: "huge",
          category: "Architecture",
          importance: 5,
          content: "x".repeat(100_000),
        }),
        memory({ id: "small", category: "Architecture", importance: 4, content: "tiny fact" }),
      ],
      { tokenBudget: 400, perItemTokenCap: 5000 },
    );

    // The oversized item is skipped rather than ending the packing loop.
    expect(ctx.groups.flatMap((g) => g.items).map((i) => i.id)).toEqual(["small"]);
  });
});

describe("buildProjectContext — markdown rendering", () => {
  it("renders a header, starred priority headings, and importance labels", () => {
    const ctx = build([
      memory({
        id: "a",
        title: "Event-sourced ledger",
        content: "Balances are a projection of an immutable event log.",
        category: "Architecture",
        importance: 5,
      }),
      memory({
        id: "b",
        title: "Weekly demo",
        content: "The team demos every Friday.",
        category: "MeetingNotes",
        importance: 3,
      }),
    ]);

    expect(ctx.markdown).toContain("# Project Context: test-project");
    expect(ctx.markdown).toContain("2 of 2 memories");
    expect(ctx.markdown).toContain("## Architecture ⭐");
    expect(ctx.markdown).toContain("## Meeting Notes");
    expect(ctx.markdown).not.toContain("## Meeting Notes ⭐");
    expect(ctx.markdown).toContain("### Event-sourced ledger");
    expect(ctx.markdown).toContain("_importance 5 Critical_");
  });

  it("notes truncation in the rendered item", () => {
    const ctx = build(
      [memory({ id: "long", category: "Architecture", content: "word ".repeat(5000) })],
      { perItemTokenCap: 20 },
    );

    expect(ctx.markdown).toContain("· truncated_");
  });

  it("is deterministic for a fixed clock and input", () => {
    const memories = [
      memory({ id: "a", category: "Architecture", importance: 4 }),
      memory({ id: "b", category: "BugFix", importance: 3 }),
    ];

    expect(build(memories)).toEqual(build(memories));
  });

  it("reports generatedAt and tokenBudget from the options", () => {
    const ctx = build([], { tokenBudget: 123 });

    expect(ctx.generatedAt).toBe(FIXED_CLOCK.toISOString());
    expect(ctx.tokenBudget).toBe(123);
    expect(ctx.projectId).toBe("test-project");
  });

  it("accepts ISO-string timestamps as well as Date objects", () => {
    const ctx = build([
      memory({ id: "a", category: "Architecture", updatedAt: "2025-03-04T05:06:07.000Z" }),
    ]);

    expect(ctx.groups[0].items[0].updatedAt).toBe("2025-03-04T05:06:07.000Z");
  });
});

describe("getProjectContext", () => {
  it("builds the package from the injected fetcher and passes the project id through", async () => {
    const seen: string[] = [];
    const ctx = await getProjectContext(
      "amc-web",
      {
        listMemories: async (projectId) => {
          seen.push(projectId);
          return [memory({ id: "a", category: "Architecture" })];
        },
      },
      { generatedAt: FIXED_CLOCK },
    );

    expect(seen).toEqual(["amc-web"]);
    expect(ctx.projectId).toBe("amc-web");
    expect(ctx.counts.included).toBe(1);
  });
});
