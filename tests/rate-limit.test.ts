import { describe, expect, it } from "vitest";

import { RateLimiter, clientIp } from "@/lib/api/rate-limit";

/**
 * The limiter is pure and clock-injectable, so all of this runs with no timers
 * and no HTTP. The cases that matter are the ones a naive fixed-window counter
 * gets wrong: the burst across a window boundary, and blocked requests keeping
 * their own window alive.
 */

const RULE = { limit: 3, windowMs: 60_000 };

describe("RateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = new RateLimiter(RULE);
    const now = 0;

    expect(limiter.check("a", now).allowed).toBe(true);
    expect(limiter.check("a", now).allowed).toBe(true);
    expect(limiter.check("a", now).allowed).toBe(true);
  });

  it("blocks the request after the limit", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);

    const result = limiter.check("a", 0);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("counts each key separately", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);

    // One user exhausting their budget must not spend anyone else's.
    expect(limiter.check("b", 0).allowed).toBe(true);
  });

  it("reports remaining budget as it is spent", () => {
    const limiter = new RateLimiter(RULE);
    expect(limiter.check("a", 0).remaining).toBe(2);
    expect(limiter.check("a", 0).remaining).toBe(1);
    expect(limiter.check("a", 0).remaining).toBe(0);
  });

  it("recovers once a full window has passed", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);
    expect(limiter.check("a", 0).allowed).toBe(false);

    // Two windows on, the earlier window carries no weight at all.
    expect(limiter.check("a", 120_000).allowed).toBe(true);
  });

  it("does not allow a double-budget burst across a window boundary", () => {
    const limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });

    // Spend the whole budget at the very end of one window...
    for (let i = 0; i < 10; i++) limiter.check("a", 59_000);

    // ...then keep pushing just after the boundary. A plain fixed-window counter
    // resets here and would hand over all ten again — a 2x burst, which is
    // exactly the shape a retry storm has. The sliding estimate still carries
    // ~97% of the previous window, so only the slack is available.
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (limiter.check("a", 60_500).allowed) allowed += 1;
    }
    expect(allowed).toBe(1);
  });

  it("lets the previous window decay as the current one progresses", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);

    // 90% through the next window, only ~0.3 of the old count still counts.
    expect(limiter.check("a", 114_000).allowed).toBe(true);
  });

  it("does not count a blocked request against the caller", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);

    // Hammering while blocked must not extend the block: a counted rejection
    // would keep pushing the window forward and lock the caller out for good.
    for (let i = 0; i < 50; i++) limiter.check("a", 30_000);

    // One full window after the last ALLOWED request, the budget is back.
    expect(limiter.check("a", 120_000).allowed).toBe(true);
  });

  it("always asks for at least one second when blocked", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);

    // 1ms before the window rolls over, a rounded-down wait would be 0 — which
    // tells a client to retry immediately.
    const result = limiter.check("a", 59_999);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("reports when the current window resets", () => {
    const limiter = new RateLimiter(RULE);
    expect(limiter.check("a", 10_000).resetAt).toBe(60_000);
    expect(limiter.check("a", 70_000).resetAt).toBe(120_000);
  });

  it("sweeps keys that can no longer affect a decision", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 100; i++) limiter.check(`key-${i}`, 0);
    expect(limiter.size).toBe(100);

    // A key two windows stale carries no weight, so holding it is pure leak.
    limiter.check("fresh", 240_000);
    expect(limiter.size).toBe(1);
  });

  it("keeps the immediately previous window during a sweep", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 30_000);

    // Sweeping at the start of the next window must not discard the history the
    // sliding estimate still needs — otherwise the sweep itself grants a full
    // fresh budget. "a" should have almost nothing left, while a key the
    // limiter has never seen has all three.
    limiter.check("other", 61_000);

    const spend = (key: string) => {
      let allowed = 0;
      for (let i = 0; i < 3; i++) {
        if (limiter.check(key, 61_000).allowed) allowed += 1;
      }
      return allowed;
    };

    expect(spend("a")).toBe(1);
    expect(spend("unseen")).toBe(3);
  });

  it("forgets everything on reset", () => {
    const limiter = new RateLimiter(RULE);
    for (let i = 0; i < 3; i++) limiter.check("a", 0);
    limiter.reset();
    expect(limiter.check("a", 0).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  const withHeaders = (headers: Record<string, string>) =>
    new Request("https://example.test/api/auth/local", { headers });

  it("takes the left-most x-forwarded-for entry", () => {
    // Left-most is the original client; the rest are the proxies it passed.
    expect(
      clientIp(withHeaders({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" })),
    ).toBe("203.0.113.7");
  });

  it("trims surrounding whitespace", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "  203.0.113.7 " }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(withHeaders({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to a constant when no proxy header is present", () => {
    // Everything unattributable shares one bucket. That is intentional: it
    // means a direct-connect deployment still gets *a* limit rather than none.
    expect(clientIp(withHeaders({}))).toBe("unknown");
  });

  it("ignores an empty x-forwarded-for", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "" }))).toBe("unknown");
  });
});
