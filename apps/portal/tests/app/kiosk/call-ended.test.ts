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
// run before the serverless function freezes. The spy runs its callback so the
// broadcastCallsChanged assertions still hold.
const after = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after };
});

let callRow: Record<string, unknown> | null = null;
let lastFilters: Record<string, unknown> = {};
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
      update: (v: Record<string, unknown>) => {
        updateSpy(v);
        const filters: Record<string, unknown> = {};
        const builder: Record<string, unknown> = {
          eq: (k: string, val: unknown) => {
            filters[k] = val;
            lastFilters = filters;
            return builder;
          },
          in: (k: string, val: unknown) => {
            filters[k] = val;
            lastFilters = filters;
            return Promise.resolve({ error: null });
          },
        };
        return builder;
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
  broadcastCallsChanged.mockClear();
  after.mockClear();
  lastFilters = {};
  callRow = { id: "call-1", property_id: "prop-1", state: "IN_PROGRESS", answered_at: "2026-06-01T00:00:00.000Z", operator_id: "op-1" };
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
    callRow = { id: "call-1", property_id: "prop-1", state: "RINGING", answered_at: null, operator_id: "op-1" };
    const token = signKioskToken("prop-1", SECRET);
    await POST(req({ callId: "call-1", reason: "no-answer" }, token));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "NO_ANSWER" }));
  });

  it("never downgrades an ANSWERED call to NO_ANSWER (concurrent-accept race)", async () => {
    // The bug: both rung browsers accepted, one claimed (answered_at set →
    // IN_PROGRESS), then the kiosk teardown reported "cancelled" and stamped the
    // answered call NO_ANSWER. An answered call that ended is COMPLETED.
    callRow = {
      id: "call-1",
      property_id: "prop-1",
      state: "IN_PROGRESS",
      answered_at: "2026-06-22T05:38:53.944Z",
      operator_id: "op-1",
    };
    const token = signKioskToken("prop-1", SECRET);
    await POST(req({ callId: "call-1", reason: "cancelled" }, token));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "COMPLETED" }));
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ state: "NO_ANSWER" }));
  });

  it("404 when the call belongs to another property", async () => {
    callRow = { id: "call-1", property_id: "OTHER", state: "RINGING", answered_at: null };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req({ callId: "call-1", reason: "no-answer" }, token))).status).toBe(404);
  });

  it("scopes the finalize to active states so it can't reopen a finalized row", async () => {
    // Guards the kiosk-vs-agent finalize race: if the agent already closed the
    // call (COMPLETED), a late kiosk call-ended must not clobber it back to FAILED.
    const token = signKioskToken("prop-1", SECRET);
    await POST(req({ callId: "call-1", reason: "failed" }, token));
    expect(lastFilters.state).toEqual(["RINGING", "IN_PROGRESS"]);
  });

  it("broadcasts calls-changed with the call's operator_id on success", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "call-1", reason: "completed" }, token));
    expect(res.status).toBe(204);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    // Regression: scheduled via after(), not bare void, so it actually runs
    // before the serverless function freezes (the prod 60s-late-clear bug).
    expect(after).toHaveBeenCalledTimes(1);
  });
});
