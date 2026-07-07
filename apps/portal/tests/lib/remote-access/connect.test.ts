import { describe, it, expect, beforeEach, vi } from "vitest";

const { reliableFetch } = vi.hoisted(() => ({ reliableFetch: vi.fn() }));

vi.mock("@/lib/http/reliable-fetch", () => ({
  reliableFetch: (...args: unknown[]) => reliableFetch(...args),
}));

import { buildRustdeskUrl, fetchRemoteCredentials } from "@/lib/remote-access/connect";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  reliableFetch.mockReset();
});

describe("buildRustdeskUrl", () => {
  it("percent-encodes a peer id containing spaces and a question mark", () => {
    const url = buildRustdeskUrl("peer 1?x", "pw");
    expect(url).toBe("rustdesk://connection/new/peer%201%3Fx?password=pw");
  });

  it("percent-encodes a unicode password", () => {
    const url = buildRustdeskUrl("123456789", "pä ss&wörd");
    expect(url).toBe(
      "rustdesk://connection/new/123456789?password=p%C3%A4%20ss%26w%C3%B6rd",
    );
  });
});

describe("fetchRemoteCredentials", () => {
  it("appends ?trigger=prewarm and uses default retries for the prewarm kind", async () => {
    reliableFetch.mockResolvedValue(jsonResponse(200, { peerId: "1", password: "p" }));
    await fetchRemoteCredentials("prop-1", "prewarm");
    expect(reliableFetch).toHaveBeenCalledTimes(1);
    const [input, init, opts] = reliableFetch.mock.calls[0]!;
    expect(input).toBe("/api/remote-access/prop-1?trigger=prewarm");
    expect(init).toBeUndefined();
    expect(opts).toEqual({ label: "remote_access.credentials" });
    // No `retries` key on the prewarm path (default retries apply).
    expect("retries" in (opts as object)).toBe(false);
  });

  it("omits the query and caps retries at 1 for the click kind", async () => {
    reliableFetch.mockResolvedValue(jsonResponse(200, { peerId: "1", password: "p" }));
    await fetchRemoteCredentials("prop-1", "click");
    const [input, , opts] = reliableFetch.mock.calls[0]!;
    expect(input).toBe("/api/remote-access/prop-1");
    expect(opts).toEqual({ label: "remote_access.credentials", retries: 1 });
  });

  it("maps a 404 to notConfigured", async () => {
    reliableFetch.mockResolvedValue(jsonResponse(404, { error: "nope" }));
    const r = await fetchRemoteCredentials("prop-1", "click");
    expect(r).toEqual({ ok: false, notConfigured: true });
  });

  it("maps a null (transport failure) to a non-notConfigured failure", async () => {
    reliableFetch.mockResolvedValue(null);
    const r = await fetchRemoteCredentials("prop-1", "prewarm");
    expect(r).toEqual({ ok: false, notConfigured: false });
  });

  it("maps a non-404 !ok (e.g. 500) to a non-notConfigured failure", async () => {
    reliableFetch.mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const r = await fetchRemoteCredentials("prop-1", "prewarm");
    expect(r).toEqual({ ok: false, notConfigured: false });
  });

  it("returns the creds on a 200 with a valid body", async () => {
    reliableFetch.mockResolvedValue(jsonResponse(200, { peerId: "id-9", password: "secret" }));
    const r = await fetchRemoteCredentials("prop-1", "prewarm");
    expect(r).toEqual({ ok: true, creds: { peerId: "id-9", password: "secret" } });
  });

  it("treats a 200 with an unparseable body as a non-notConfigured failure", async () => {
    reliableFetch.mockResolvedValue(new Response("not json", { status: 200 }));
    const r = await fetchRemoteCredentials("prop-1", "prewarm");
    expect(r).toEqual({ ok: false, notConfigured: false });
  });
});

// launchRustdesk touches the DOM (a transient iframe), so it's covered in the
// jsdom launch-rustdesk.test.ts (and via the call-surface-provider cache-hit
// path), not here (node env).
