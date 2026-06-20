import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRecentErrorCount } from "@/lib/sentry/errors";

function fakeFetch(body: unknown, _ok = true, status = 200): typeof fetch {
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

  it("prefers SENTRY_READ_TOKEN (the upload-only SENTRY_AUTH_TOKEN 403s on the issues API)", async () => {
    vi.stubEnv("SENTRY_READ_TOKEN", "read-tok");
    vi.stubEnv("SENTRY_AUTH_TOKEN", "upload-tok");
    let auth: string | null = null;
    const capturing = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify([{ id: "1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    expect(await getRecentErrorCount(capturing)).toBe(1);
    expect(auth).toBe("Bearer read-tok");
  });

  it("falls back to SENTRY_AUTH_TOKEN when no read token is set", async () => {
    let auth: string | null = null;
    const capturing = (async (_url: string, init: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await getRecentErrorCount(capturing);
    expect(auth).toBe("Bearer tok");
  });

  it("scopes the count to recently-active issues (last 24h), not all-time unresolved", async () => {
    let url = "";
    const capturing = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await getRecentErrorCount(capturing);
    const q = decodeURIComponent(url);
    expect(q).toContain("is:unresolved");
    expect(q).toContain("lastSeen:-24h");
  });
});
