import { describe, expect, it } from "vitest";

import {
  createLocalSessionToken,
  verifyLocalSessionToken,
} from "@/server/localSession";

/**
 * The local-auth cookie is the only thing standing between a visitor and
 * another user's dashboard when Supabase isn't configured, so tampering must
 * always be rejected — a forged email here would be a full account takeover in
 * local mode.
 */

describe("createLocalSessionToken", () => {
  it("round-trips an email", () => {
    const token = createLocalSessionToken("dev@example.com");

    expect(verifyLocalSessionToken(token)).toBe("dev@example.com");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(verifyLocalSessionToken(createLocalSessionToken("  Dev@Example.COM  "))).toBe(
      "dev@example.com",
    );
  });

  it("issues the same token for the same email (stateless, restart-safe)", () => {
    expect(createLocalSessionToken("a@b.com")).toBe(createLocalSessionToken("a@b.com"));
  });

  it("issues different tokens for different emails", () => {
    expect(createLocalSessionToken("a@b.com")).not.toBe(createLocalSessionToken("c@d.com"));
  });

  it("emits a payload.signature shape with no raw email in the clear", () => {
    const token = createLocalSessionToken("dev@example.com");

    expect(token.split(".")).toHaveLength(2);
    expect(token).not.toContain("dev@example.com");
  });
});

describe("verifyLocalSessionToken", () => {
  it("rejects a missing or malformed token", () => {
    expect(verifyLocalSessionToken(undefined)).toBeNull();
    expect(verifyLocalSessionToken("")).toBeNull();
    expect(verifyLocalSessionToken("no-dot-separator")).toBeNull();
    expect(verifyLocalSessionToken(".")).toBeNull();
  });

  it("rejects a swapped payload — the signature no longer matches", () => {
    const mine = createLocalSessionToken("attacker@example.com");
    const victimPayload = Buffer.from("admin@example.com").toString("base64url");
    const forged = `${victimPayload}.${mine.split(".")[1]}`;

    expect(verifyLocalSessionToken(forged)).toBeNull();
  });

  it("rejects an unsigned token", () => {
    const payload = Buffer.from("admin@example.com").toString("base64url");

    expect(verifyLocalSessionToken(`${payload}.`)).toBeNull();
    expect(verifyLocalSessionToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects a token whose signature has been altered", () => {
    const [payload, sig] = createLocalSessionToken("dev@example.com").split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");

    expect(verifyLocalSessionToken(`${payload}.${flipped}`)).toBeNull();
  });

  it("rejects a signature of a different length without throwing", () => {
    const [payload] = createLocalSessionToken("dev@example.com").split(".");

    expect(verifyLocalSessionToken(`${payload}.short`)).toBeNull();
  });
});
