import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let callRow: Record<string, unknown> | null = null;
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
      update: (v: Record<string, unknown>) => {
        updateSpy(v);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));

import { POST } from "@/app/api/kiosk/call-ended/route";

function req(body: unknown, token?: string) {
  return new Request("http://localhost:3000/api/kiosk/call-ended", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-kiosk-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  callRow = { id: "call-1", property_id: "prop-1", state: "IN_PROGRESS", answered_at: "2026-06-01T00:00:00.000Z" };
});

describe("POST /api/kiosk/call-ended", () => {
  it("401 without a token", async () => {
    expect((await POST(req({ callId: "call-1", reason: "completed" }))).status).toBe(401);
  });

  it("marks COMPLETED + ended_at + duration from answered_at", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "call-1", reason: "completed" }, token));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED" }),
    );
    expect(updateSpy.mock.calls[0]?.[0]).toHaveProperty("ended_at");
    expect(updateSpy.mock.calls[0]?.[0]).toHaveProperty("duration_seconds");
  });

  it("maps no-answer → NO_ANSWER", async () => {
    callRow = { id: "call-1", property_id: "prop-1", state: "RINGING", answered_at: null };
    const token = signKioskToken("prop-1", SECRET);
    await POST(req({ callId: "call-1", reason: "no-answer" }, token));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "NO_ANSWER" }));
  });

  it("404 when the call belongs to another property", async () => {
    callRow = { id: "call-1", property_id: "OTHER", state: "RINGING", answered_at: null };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req({ callId: "call-1", reason: "no-answer" }, token))).status).toBe(404);
  });
});
