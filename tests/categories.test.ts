import { describe, expect, it } from "vitest";

import {
  CATEGORY_META,
  DEFAULT_CATEGORY,
  DEFAULT_IMPORTANCE,
  IMPORTANCE_LABELS,
  IMPORTANCE_LEVELS,
  MEMORY_CATEGORIES,
  PRIORITY_CATEGORIES,
  categoryLabel,
  importanceLabel,
  importanceSchema,
  isPriorityCategory,
  memoryCategorySchema,
} from "@/lib/categories";

/**
 * The taxonomy is the single source of truth shared by forms, filters, API
 * validation, and the context builder. These tests guard the invariants that
 * keep those consumers in sync when a category is added or removed.
 */

describe("category set", () => {
  it("has no duplicate values", () => {
    expect(new Set(MEMORY_CATEGORIES).size).toBe(MEMORY_CATEGORIES.length);
  });

  it("has presentation metadata for every category and no orphans", () => {
    expect(Object.keys(CATEGORY_META).sort()).toEqual([...MEMORY_CATEGORIES].sort());

    for (const category of MEMORY_CATEGORIES) {
      const meta = CATEGORY_META[category];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      // Every badge must define both a light and a dark variant.
      expect(meta.badgeClass).toMatch(/dark:/);
    }
  });

  it("gives each category a distinct badge colour", () => {
    const badges = MEMORY_CATEGORIES.map((c) => CATEGORY_META[c].badgeClass);
    expect(new Set(badges).size).toBe(badges.length);
  });

  it("draws every priority category from the main set", () => {
    for (const category of PRIORITY_CATEGORIES) {
      expect(MEMORY_CATEGORIES).toContain(category);
      expect(isPriorityCategory(category)).toBe(true);
    }
  });

  it("does not mark ordinary categories as priority", () => {
    expect(isPriorityCategory("General")).toBe(false);
    expect(isPriorityCategory("BugReport")).toBe(false);
  });

  it("uses a real category as the default", () => {
    expect(MEMORY_CATEGORIES).toContain(DEFAULT_CATEGORY);
  });

  it("resolves labels from the metadata table", () => {
    expect(categoryLabel("TechnicalDecision")).toBe("Technical Decision");
    expect(categoryLabel("General")).toBe("General");
  });
});

describe("memoryCategorySchema", () => {
  it("accepts every value in the set", () => {
    for (const category of MEMORY_CATEGORIES) {
      expect(memoryCategorySchema.parse(category)).toBe(category);
    }
  });

  it("rejects values outside the closed set", () => {
    expect(memoryCategorySchema.safeParse("NotACategory").success).toBe(false);
    expect(memoryCategorySchema.safeParse("architecture").success).toBe(false);
    expect(memoryCategorySchema.safeParse("").success).toBe(false);
  });
});

describe("importance scale", () => {
  it("labels every level", () => {
    for (const level of IMPORTANCE_LEVELS) {
      expect(IMPORTANCE_LABELS[level]).toBeTruthy();
    }
  });

  it("uses a valid level as the default", () => {
    expect(IMPORTANCE_LEVELS).toContain(DEFAULT_IMPORTANCE);
  });

  it("formats a level as '<value> <label>'", () => {
    expect(importanceLabel(5)).toBe("5 Critical");
    expect(importanceLabel(3)).toBe("3 Moderate");
  });

  it("falls back to the bare number for out-of-range values", () => {
    expect(importanceLabel(9)).toBe("9");
  });

  it("accepts integers 1-5 and rejects everything else", () => {
    for (const level of IMPORTANCE_LEVELS) {
      expect(importanceSchema.parse(level)).toBe(level);
    }
    expect(importanceSchema.safeParse(0).success).toBe(false);
    expect(importanceSchema.safeParse(6).success).toBe(false);
    expect(importanceSchema.safeParse(3.5).success).toBe(false);
    expect(importanceSchema.safeParse("4").success).toBe(false);
  });
});
