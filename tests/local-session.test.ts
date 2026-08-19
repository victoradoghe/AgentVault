import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * In production the committed dev fallback secret must never be used: it is
 * public source, so signing with it means anyone can mint a cookie for any
 * email. Both directions have to fail closed — refusing to issue tokens is not
 * enough if previously-issued (or forged) ones still verify.
 */
describe("production without AMC_LOCAL_AUTH_SECRET", () => {
  const ORIGINAL_SECRET = process.env.AMC_LOCAL_AUTH_SECRET;

  beforeEach(() => {
    delete process.env.AMC_LOCAL_AUTH_SECRET;
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (ORIGINAL_SECRET === undefined) delete process.env.AMC_LOCAL_AUTH_SECRET;
    else process.env.AMC_LOCAL_AUTH_SECRET = ORIGINAL_SECRET;
  });

  it("refuses to issue a token rather than signing with the public fallback", () => {
    expect(() => createLocalSessionToken("dev@example.com")).toThrow(
      /AMC_LOCAL_AUTH_SECRET/,
    );
  });

  it("rejects a token forged with the committed fallback secret", () => {
    // Exactly what an attacker who read the source would send.
    const forged = createHmacToken("victim@example.com", "amc-local-dev-auth-secret-change-me");

    expect(verifyLocalSessionToken(forged)).toBeNull();
  });

  it("accepts tokens again once a real secret is configured", () => {
    process.env.AMC_LOCAL_AUTH_SECRET = "a-real-production-secret";

    expect(verifyLocalSessionToken(createLocalSessionToken("dev@example.com"))).toBe(
      "dev@example.com",
    );
  });
});

/** Build a token the way the module does, but with a chosen key. */
function createHmacToken(email: string, key: string): string {
  const payload = Buffer.from(email.trim().toLowerCase()).toString("base64url");
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
