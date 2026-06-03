import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRecentErrorCount } from "@/lib/sentry/errors";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("SENTRY_ORG", "lobby-connect");
  vi.stubEnv("SENTRY_PROJECT", "portal");
  vi.stubEnv("SENTRY_AUTH_TOKEN", "tok");
});
afterEach(() => vi.unstubAllEnvs());

describe("getRecentErrorCount", () => {
  it("returns null when config is missing", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    expect(await getRecentErrorCount(fakeFetch([{}, {}]))).toBeNull();
  });

  it("returns the issue array length on success", async () => {
    expect(await getRecentErrorCount(fakeFetch([{ id: "1" }, { id: "2" }, { id: "3" }]))).toBe(3);
  });

  it("returns null on a non-ok response", async () => {
    expect(await getRecentErrorCount(fakeFetch({ detail: "no" }, false, 500))).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const throwing = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await getRecentErrorCount(throwing)).toBeNull();
  });
});
