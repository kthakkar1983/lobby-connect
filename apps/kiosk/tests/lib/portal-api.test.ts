import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Config is mocked so the test needs no jsdom window / env — it focuses purely
// on how fetchIncomingCall maps an HTTP response to a poll result.
vi.mock("@/lib/config", () => ({
  getKioskToken: () => "tok",
  getPortalApiBase: () => "https://portal.test",
}));

import { fetchIncomingCall } from "@/lib/portal-api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubFetch(impl: () => any) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("fetchIncomingCall — poll-result mapping", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("maps a 200 with a ringing call body to { status: 'ringing', call }", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ callId: "c1", channelName: "ch1" }) }));
    await expect(fetchIncomingCall()).resolves.toEqual({
      status: "ringing",
      call: { callId: "c1", channelName: "ch1" },
    });
  });

  it("maps a 200 with a null body (no ringing call) to { status: 'idle' }", async () => {
    stubFetch(async () => ({ ok: true, json: async () => null }));
    await expect(fetchIncomingCall()).resolves.toEqual({ status: "idle" });
  });

  it("maps a non-ok response to { status: 'error' } — a transient 5xx is NOT 'call gone'", async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(fetchIncomingCall()).resolves.toEqual({ status: "error" });
  });

  it("maps a network failure (fetch rejects) to { status: 'error' } — never a false 'idle'", async () => {
    stubFetch(() => Promise.reject(new Error("network")));
    await expect(fetchIncomingCall()).resolves.toEqual({ status: "error" });
  });
});
