import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth-mode resolution decides whether a visitor can sign in at all, so the
 * cases that matter are the ones where a deployment is misconfigured: local
 * mode is passwordless, and letting it activate by accident in production would
 * mean anyone can claim any email and read that user's memories.
 *
 * The module reads `process.env` at call time (not import time), but NODE_ENV
 * is baked into module scope by nothing here — so each test sets the env and
 * re-imports through `vi.resetModules()` to be certain it sees the value.
 */

const ORIGINAL_ENV = { ...process.env };

async function loadAuthMode() {
  vi.resetModules();
  return import("@/lib/auth-mode");
}

/** A syntactically valid Supabase configuration. */
function configureSupabase() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefg.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
}

function clearSupabase() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

beforeEach(() => {
  clearSupabase();
  delete process.env.NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe("getAuthMode", () => {
  it("uses Supabase whenever it is configured, in any environment", async () => {
    configureSupabase();
    vi.stubEnv("NODE_ENV", "production");

    const { getAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("supabase");
  });

  it("falls back to local mode outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { getAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("local");
  });

  it("refuses to fall back to passwordless local mode in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { getAuthMode, isLocalAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("unconfigured");
    expect(isLocalAuthMode()).toBe(false);
  });

  it("allows local mode in production only on an explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH = "true";

    const { getAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("local");
  });

  it("treats any value other than 'true' as no opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");

    for (const value of ["1", "yes", "TRUE", "false", ""]) {
      process.env.NEXT_PUBLIC_AMC_ALLOW_LOCAL_AUTH = value;
      const { getAuthMode } = await loadAuthMode();

      expect(getAuthMode(), `value: ${JSON.stringify(value)}`).toBe("unconfigured");
    }
  });

  it("stays unconfigured when Supabase vars are half-filled in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // URL present, key missing — the classic one-variable-short deploy.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefg.supabase.co";

    const { getAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("unconfigured");
  });

  it("stays unconfigured when the placeholder URL is left in place", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    const { getAuthMode } = await loadAuthMode();

    expect(getAuthMode()).toBe("unconfigured");
  });
});

describe("isAuthUnconfigured", () => {
  it("is the inverse of having a usable backend", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { isAuthUnconfigured } = await loadAuthMode();

    expect(isAuthUnconfigured()).toBe(true);
  });
});
