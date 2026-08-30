/**
 * Request rate limiting for the AgentVault REST API.
 *
 * Two things here: a pure sliding-window counter (`RateLimiter`), and the thin
 * request-shaped wrapper the route handlers actually call (`enforceRateLimit`).
 * The split exists so the counting logic is unit-testable with a fake clock and
 * no HTTP involved.
 *
 * ## What this is, and what it is not
 *
 * The store is an in-process `Map`. That makes it a real defence for the things
 * that actually threaten this app — a runaway agent loop, a stuck retry, a
 * script hammering sign-in from one machine — and NOT a defence against a
 * distributed attacker. On a serverless host each instance counts separately,
 * so the effective ceiling is `limit x instances`.
 *
 * That tradeoff is deliberate: the alternative is requiring Redis to run
 * AgentVault at all, which is a heavy dependency for a self-hosted memory store.
 * If you deploy this somewhere that needs a hard global ceiling, put a limiter
 * in front of it (Vercel Firewall, Cloudflare) — this one stays useful
 * underneath it as a per-instance backstop.
 *
 * Limits are keyed by acting user wherever the caller is authenticated, so one
 * user's runaway agent cannot exhaust anybody else's budget. Only the sign-in
 * endpoint — which by definition has no user yet — falls back to the client IP.
 */
import { errorResponse } from "./http";

/** A limit: at most `limit` requests in any `windowMs` window. */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

/** The outcome of one `check()`, including the headers a 429 should carry. */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window (0 when blocked). */
  remaining: number;
  /** Epoch ms at which the current window fully rolls over. */
  resetAt: number;
  /** Whole seconds the caller should wait; always >= 1 when blocked. */
  retryAfterSeconds: number;
}

/** Per-key state: the two fixed windows a sliding count is interpolated from. */
interface Bucket {
  /** Index of the window `current` counts, i.e. floor(now / windowMs). */
  window: number;
  current: number;
  previous: number;
}

/**
 * Sliding-window counter.
 *
 * A plain fixed window lets a caller spend its whole budget at the end of one
 * window and again at the start of the next — a 2x burst across the boundary,
 * which is exactly the shape a retry storm has. So each window's count is
 * weighted by how far into it we are and added to the previous window's,
 * giving a smooth estimate with only two integers of state per key.
 *
 * Cost is O(1) per check and two numbers per active key. Expired keys are swept
 * lazily (see `maybeSweep`) so an idle limiter does not grow without bound.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly rule: RateLimitRule) {}

  /**
   * Record a request against `key` and say whether it is allowed.
   *
   * `now` is injectable so tests can drive the clock; production callers omit
   * it. A blocked request is NOT counted — otherwise a caller that keeps
   * retrying would hold its own window open forever.
   */
  check(key: string, now: number = Date.now()): RateLimitResult {
    const { limit, windowMs } = this.rule;
    this.maybeSweep(now);

    const window = Math.floor(now / windowMs);
    const bucket = this.buckets.get(key);
    const state = this.rollForward(bucket, window);

    // How far through the current window we are, in [0, 1).
    const elapsed = (now % windowMs) / windowMs;
    const estimate = state.previous * (1 - elapsed) + state.current;

    const resetAt = (window + 1) * windowMs;

    if (estimate >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt,
        // Never report 0 — a Retry-After of 0 invites an immediate retry.
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    state.current += 1;
    this.buckets.set(key, state);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, Math.floor(limit - estimate - 1)),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Advance a bucket to `window`, carrying or discarding its counts depending
   * on how many windows have elapsed. A bucket more than one window old has no
   * history worth keeping.
   */
  private rollForward(bucket: Bucket | undefined, window: number): Bucket {
    if (!bucket) return { window, current: 0, previous: 0 };
    if (bucket.window === window) return bucket;
    if (bucket.window === window - 1) {
      return { window, current: 0, previous: bucket.current };
    }
    return { window, current: 0, previous: 0 };
  }

  /**
   * Drop keys that can no longer affect any decision. Runs at most once per
   * window so a burst of distinct keys does not turn every request into a full
   * map scan.
   */
  private maybeSweep(now: number): void {
    const { windowMs } = this.rule;
    if (now - this.lastSweep < windowMs) return;
    this.lastSweep = now;

    const oldest = Math.floor(now / windowMs) - 1;
    for (const [key, bucket] of this.buckets) {
      if (bucket.window < oldest) this.buckets.delete(key);
    }
  }

  /** Test/ops hook: forget all state. */
  reset(): void {
    this.buckets.clear();
    this.lastSweep = 0;
  }

  /** Number of keys currently held. Used by the sweep tests. */
  get size(): number {
    return this.buckets.size;
  }
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * Sign-in. Keyed by IP because there is no user yet, and deliberately the
 * tightest rule here: in local auth mode this endpoint mints a session from an
 * email alone, so it is the one place where hammering it has a security payoff
 * rather than merely a cost one.
 */
export const AUTH_RULE: RateLimitRule = { limit: 10, windowMs: 10 * 60_000 };

/**
 * Routes that run the embedding model (search, and memory create/update).
 * These are CPU-bound and, on a serverless host, the only endpoints that can
 * turn a loop bug into a bill. Lower than the general limit for that reason.
 */
export const EMBEDDING_RULE: RateLimitRule = { limit: 30, windowMs: 60_000 };

/** Minting API keys — rare by nature, and each one is a durable credential. */
export const KEY_MINTING_RULE: RateLimitRule = { limit: 10, windowMs: 60 * 60_000 };

/**
 * Everything else. Generous: an agent legitimately reads its project context
 * and memory list often, and this rule exists to stop a runaway loop, not to
 * pace normal use.
 */
export const GENERAL_RULE: RateLimitRule = { limit: 240, windowMs: 60_000 };

/**
 * One limiter per rule, module-scoped so state survives between requests.
 *
 * In development Next.js re-evaluates modules on hot reload, which would reset
 * the counters on every edit; caching on `globalThis` keeps them, matching what
 * `prisma.ts` does and for the same reason.
 */
const globalForLimiters = globalThis as unknown as {
  amcRateLimiters: Map<RateLimitRule, RateLimiter> | undefined;
};

const limiters = (globalForLimiters.amcRateLimiters ??= new Map());

function limiterFor(rule: RateLimitRule): RateLimiter {
  let limiter = limiters.get(rule);
  if (!limiter) {
    limiter = new RateLimiter(rule);
    limiters.set(rule, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// Request wrapper
// ---------------------------------------------------------------------------

/**
 * Best-effort client IP.
 *
 * Behind a proxy that sets `x-forwarded-for` (Vercel, Cloudflare, most
 * reverse proxies) the left-most entry is the real client. Run with no proxy in
 * front and a client can put whatever it likes there — which is why IP keying is
 * used ONLY for sign-in, where there is no better key and the alternative is no
 * limit at all. Everything else keys on the authenticated user id, which cannot
 * be spoofed.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Standard rate-limit headers, so a well-behaved client can pace itself. */
function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
}

/**
 * Apply `rule` to `identity`. Returns a ready-to-send 429 when the caller is
 * over budget, or `null` when the request may proceed.
 *
 * Route handlers use it as an early return:
 *
 * ```ts
 * const limited = enforceRateLimit(EMBEDDING_RULE, auth.userId);
 * if (limited) return limited;
 * ```
 *
 * `identity` should be an authenticated user id wherever one exists; prefix it
 * so two different kinds of identity can never collide on the same key.
 */
export function enforceRateLimit(
  rule: RateLimitRule,
  identity: string,
): Response | null {
  const result = limiterFor(rule).check(identity);
  if (result.allowed) return null;

  const res = errorResponse(
    429,
    `Too many requests. Retry in ${result.retryAfterSeconds}s.`,
  );
  res.headers.set("Retry-After", String(result.retryAfterSeconds));
  for (const [name, value] of Object.entries(rateLimitHeaders(result))) {
    res.headers.set(name, value);
  }
  return res;
}

/** Test hook: clear every limiter's state between cases. */
export function resetAllRateLimits(): void {
  for (const limiter of limiters.values()) limiter.reset();
}
