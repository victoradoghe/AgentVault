import { describe, expect, it } from "vitest";

import { DEFAULT_SIGNED_IN_PATH, resolveNextPath } from "@/lib/redirects";

/**
 * `?next=` decides where the sign-in pages send you once you authenticate.
 * The middleware sets it, but anyone can craft a link with their own value, so
 * an unvalidated value turns our own login page into an open redirect: the
 * victim signs in on the real site and is bounced to an attacker's origin.
 * Only root-relative paths may survive.
 */

describe("resolveNextPath", () => {
  it("keeps a root-relative path", () => {
    expect(resolveNextPath("/dashboard/projects/my-app")).toBe(
      "/dashboard/projects/my-app",
    );
  });

  it("preserves query strings and fragments on an internal path", () => {
    expect(resolveNextPath("/dashboard?tab=keys#top")).toBe(
      "/dashboard?tab=keys#top",
    );
  });

  it("falls back to the dashboard when nothing was requested", () => {
    expect(resolveNextPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath("")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects absolute URLs to another origin", () => {
    expect(resolveNextPath("https://evil.example/phish")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
    expect(resolveNextPath("http://evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects protocol-relative URLs, which leave the origin without a scheme", () => {
    expect(resolveNextPath("//evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath("///evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects backslash variants, since browsers normalise \\ to /", () => {
    expect(resolveNextPath("/\\evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath("\\/evil.example")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath("/dashboard\\..\\..")).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("rejects non-http schemes", () => {
    expect(resolveNextPath("javascript:alert(1)")).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(resolveNextPath("data:text/html,<script>")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("rejects a leading-whitespace path that would otherwise smuggle a scheme", () => {
    expect(resolveNextPath("  https://evil.example")).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });

  it("only ever returns a same-origin path", () => {
    const hostile = [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
    ];

    for (const value of hostile) {
      const resolved = resolveNextPath(value);

      expect(resolved.startsWith("/")).toBe(true);
      expect(resolved.startsWith("//")).toBe(false);
      expect(resolved).not.toContain("evil.example");
    }
  });
});
