import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" },
}));
const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
}));
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";

beforeEach(() => { captureException.mockClear(); captureMessage.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("broadcastCallsChanged", () => {
  it("POSTs a calls-changed message to the Realtime broadcast endpoint with the service key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);
    await broadcastCallsChanged("op-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-key");
    expect(init.headers.Authorization).toBe("Bearer service-key");
    expect(JSON.parse(init.body)).toEqual({
      messages: [{ topic: "operator:op-1:calls", event: "calls-changed", payload: {} }],
    });
  });
  it("swallows a non-2xx response and reports it (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(broadcastCallsChanged("op-1")).resolves.toBeUndefined();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
  it("swallows a thrown fetch error and reports it (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(broadcastCallsChanged("op-1")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
