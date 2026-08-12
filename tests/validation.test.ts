import { describe, expect, it } from "vitest";

import {
  CATEGORY_FILTER_ALL,
  categoryFilterSchema,
  memoryInputSchema,
  memoryUpdateSchema,
} from "@/lib/validation";
import { DEFAULT_CATEGORY, DEFAULT_IMPORTANCE } from "@/lib/categories";

/**
 * The same schemas validate the dashboard forms and the REST route handlers,
 * so a gap here is a gap in the API's input handling.
 */

describe("memoryInputSchema", () => {
  it("applies defaults for category and importance", () => {
    const parsed = memoryInputSchema.parse({ title: "A title", content: "Some content" });

    expect(parsed.category).toBe(DEFAULT_CATEGORY);
    expect(parsed.importance).toBe(DEFAULT_IMPORTANCE);
  });

  it("trims surrounding whitespace", () => {
    const parsed = memoryInputSchema.parse({
      title: "  Padded title  ",
      content: "  Padded content  ",
    });

    expect(parsed.title).toBe("Padded title");
    expect(parsed.content).toBe("Padded content");
  });

  it("rejects a title or content that is empty after trimming", () => {
    expect(memoryInputSchema.safeParse({ title: "   ", content: "ok" }).success).toBe(false);
    expect(memoryInputSchema.safeParse({ title: "ok", content: "   " }).success).toBe(false);
  });

  it("enforces the length ceilings", () => {
    expect(
      memoryInputSchema.safeParse({ title: "a".repeat(200), content: "ok" }).success,
    ).toBe(true);
    expect(
      memoryInputSchema.safeParse({ title: "a".repeat(201), content: "ok" }).success,
    ).toBe(false);
    expect(
      memoryInputSchema.safeParse({ title: "ok", content: "a".repeat(20_000) }).success,
    ).toBe(true);
    expect(
      memoryInputSchema.safeParse({ title: "ok", content: "a".repeat(20_001) }).success,
    ).toBe(false);
  });

  it("rejects an unknown category or an out-of-range importance", () => {
    expect(
      memoryInputSchema.safeParse({ title: "t", content: "c", category: "Nope" }).success,
    ).toBe(false);
    expect(
      memoryInputSchema.safeParse({ title: "t", content: "c", importance: 7 }).success,
    ).toBe(false);
  });

  it("requires both title and content", () => {
    expect(memoryInputSchema.safeParse({ content: "c" }).success).toBe(false);
    expect(memoryInputSchema.safeParse({ title: "t" }).success).toBe(false);
  });
});

describe("memoryUpdateSchema", () => {
  it("accepts a partial patch", () => {
    expect(memoryUpdateSchema.parse({ importance: 5 })).toEqual({ importance: 5 });
    expect(memoryUpdateSchema.parse({ title: "New title" })).toEqual({ title: "New title" });
  });

  it("accepts an empty patch without inventing defaults", () => {
    expect(memoryUpdateSchema.parse({})).toEqual({});
  });

  it("still validates the fields that are present", () => {
    expect(memoryUpdateSchema.safeParse({ importance: 0 }).success).toBe(false);
    expect(memoryUpdateSchema.safeParse({ category: "Nope" }).success).toBe(false);
    expect(memoryUpdateSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("categoryFilterSchema", () => {
  it("accepts the 'all' sentinel and any real category", () => {
    expect(categoryFilterSchema.parse(CATEGORY_FILTER_ALL)).toBe("all");
    expect(categoryFilterSchema.parse("Architecture")).toBe("Architecture");
  });

  it("rejects anything else", () => {
    expect(categoryFilterSchema.safeParse("none").success).toBe(false);
  });
});
