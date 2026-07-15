import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

const broadcastCallsChanged = vi.fn();
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastCallsChanged: (...a: unknown[]) => broadcastCallsChanged(...a),
}));

// The broadcast must be scheduled via next/server `after()` (guaranteed
// post-response work), NOT a bare `void` — a detached fetch is not guaranteed to
// run before the serverless function freezes (mirrors the other kiosk routes).
// The spy runs its callback so the broadcastCallsChanged assertions still hold.
const after = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

let claimResult: { channelName: string; operatorId: string } | null = {
  channelName: "call_abc",
  operatorId: "op-1",
};
const claimOutboundByKiosk = vi.fn();
vi.mock("@/lib/voice/call-state", () => ({
  claimOutboundByKiosk: (...a: unknown[]) => claimOutboundByKiosk(...a),
}));

import { POST } from "@/app/api/kiosk/answer-call/route";

function req(body: unknown, token?: string) {
  return new Request("http://localhost:3000/api/kiosk/answer-call", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-kiosk-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  claimOutboundByKiosk.mockReset();
  claimOutboundByKiosk.mockImplementation(() => Promise.resolve(claimResult));
  broadcastCallsChanged.mockClear();
  after.mockClear();
  claimResult = { channelName: "call_abc", operatorId: "op-1" };
});

describe("POST /api/kiosk/answer-call", () => {
  it("401 without a token", async () => {
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(401);
    expect(claimOutboundByKiosk).not.toHaveBeenCalled();
  });

  it("401 with an invalid/garbage token", async () => {
    const res = await POST(req({ callId: "c1" }, "not-a-real-token"));
    expect(res.status).toBe(401);
    expect(claimOutboundByKiosk).not.toHaveBeenCalled();
  });

  it("400 when callId is missing", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({}, token));
    expect(res.status).toBe(400);
    expect(claimOutboundByKiosk).not.toHaveBeenCalled();
  });

  it("409 when the call is no longer claimable (already answered/cancelled/timed out)", async () => {
    claimResult = null;
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "c1" }, token));
    expect(res.status).toBe(409);
    expect(broadcastCallsChanged).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("claims scoped to the token's propertyId and returns the channelName on success", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "c1" }, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ channelName: "call_abc" });
    expect(claimOutboundByKiosk).toHaveBeenCalledWith(expect.anything(), "c1", "prop-1");
  });

  it("broadcasts calls-changed with the claimed call's operator_id on success, via after()", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "c1" }, token));
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    // Regression: scheduled via after(), not bare void (see call-started/call-ended).
    expect(after).toHaveBeenCalledTimes(1);
  });
});
