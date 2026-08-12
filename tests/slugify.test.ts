import { describe, expect, it } from "vitest";

import { slugify } from "@/server/projects";

/**
 * Slugs are the project's public identifier — they appear in dashboard URLs and
 * in every REST path the MCP server calls — so they must always be non-empty
 * and URL-safe, whatever the user types as a project name.
 */

describe("slugify", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(slugify("Orbital Payments Platform")).toBe("orbital-payments-platform");
  });

  it("collapses runs of punctuation and whitespace into single hyphens", () => {
    expect(slugify("My   App!!! v2")).toBe("my-app-v2");
    expect(slugify("a/b\\c_d")).toBe("a-b-c-d");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("folds accents to ASCII", () => {
    expect(slugify("Café Münchén")).toBe("cafe-munchen");
  });

  it("caps the length at 60 characters with no trailing hyphen", () => {
    const slug = slugify("word ".repeat(40));

    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to 'project' when nothing survives normalisation", () => {
    expect(slugify("")).toBe("project");
    expect(slugify("   ")).toBe("project");
    expect(slugify("!!!")).toBe("project");
    expect(slugify("日本語")).toBe("project");
  });

  it("only ever emits url-safe characters", () => {
    for (const name of ["Hello, World!", "  --Hello--  ", "Café Münchén", "a/b\\c_d", "!!!"]) {
      expect(slugify(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("is idempotent — slugging a slug changes nothing", () => {
    const slug = slugify("Orbital Payments Platform");

    expect(slugify(slug)).toBe(slug);
  });
});
