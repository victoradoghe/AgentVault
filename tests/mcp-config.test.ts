import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  loadConfig,
} from "../packages/amc-mcp/src/config";

/**
 * Config comes from environment variables a user pastes into an agent's MCP
 * config, so it must survive whatever ends up in there — including a blank or
 * nonsensical value for an optional tuning knob, which should degrade to the
 * default rather than take the server down at startup.
 */

describe("loadConfig", () => {
  it("requires an API key", () => {
    expect(() => loadConfig({})).toThrow(/AMC_API_KEY/);
    expect(() => loadConfig({ AMC_API_KEY: "   " })).toThrow(/AMC_API_KEY/);
  });

  it("falls back to a local server when no base URL is given", () => {
    expect(loadConfig({ AMC_API_KEY: "amc_k" }).baseUrl).toBe(DEFAULT_BASE_URL);
  });

  // AgentVault is self-hosted, so the default must be somewhere the user can
  // actually run it. A default pointing at someone else's deployment fails
  // every call with an error that blames the network, not the missing setting.
  it("defaults to a host the user controls", () => {
    expect(DEFAULT_BASE_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  });

  it("strips trailing slashes so path joins stay predictable", () => {
    const { baseUrl } = loadConfig({
      AMC_API_KEY: "amc_k",
      AMC_BASE_URL: "http://localhost:3000///",
    });

    expect(baseUrl).toBe("http://localhost:3000");
  });

  it("defaults the request timeout to a cold-start-tolerant budget", () => {
    expect(loadConfig({ AMC_API_KEY: "amc_k" }).requestTimeoutMs).toBe(
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  });

  it("accepts an explicit request timeout", () => {
    expect(
      loadConfig({ AMC_API_KEY: "amc_k", AMC_REQUEST_TIMEOUT_MS: "90000" })
        .requestTimeoutMs,
    ).toBe(90_000);
  });

  it("ignores an unusable timeout instead of failing to start", () => {
    for (const value of ["", "  ", "abc", "0", "-5", "NaN"]) {
      expect(
        loadConfig({ AMC_API_KEY: "amc_k", AMC_REQUEST_TIMEOUT_MS: value })
          .requestTimeoutMs,
      ).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    }
  });
});
