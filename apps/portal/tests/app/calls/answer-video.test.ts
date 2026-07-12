import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const broadcastCallsChanged = vi.fn();
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastCallsChanged: (...a: unknown[]) => broadcastCallsChanged(...a),
}));

const sendCallPush = vi.fn();
vi.mock("@/lib/push/send", () => ({
  sendCallPush: (...a: unknown[]) => sendCallPush(...a),
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
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after };
});

let callRow: Record<string, unknown> | null = null;
// Controls what the guarded UPDATE returns — default winner (one row claimed).
let callUpdateResult: Array<{ id: string }> = [{ id: "call-1" }];
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(
  async (): Promise<{ data: Record<string, unknown> }> => ({
    // requireApiActor reads id/operator_id/role/active; requireOnDuty reads
    // status/last_seen_at — a live shift keeps the hard gate open by default.
    data: {
      id: "u1",
      operator_id: "op-1",
      role: "AGENT",
      status: "AVAILABLE",
      last_seen_at: new Date(Date.now() - 10_000).toISOString(),
    },
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => { profileUpdateSpy(v); return { eq: () => Promise.resolve({ error: null }) }; },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
        // Chain: .update().eq("id").eq("state","RINGING").select("id") → { data: callUpdateResult }
        update: (v: unknown) => { callUpdateSpy(v); return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: callUpdateResult, error: null }) }) }) }; },
      };
    },
  }),
}));

import { POST } from "@/app/api/calls/[id]/answer-video/route";

function call(id: string) {
  const request = new Request(`http://localhost:3000/api/calls/${id}/answer-video`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  getUser.mockReset();
  callUpdateSpy.mockClear();
  profileUpdateSpy.mockClear();
  broadcastCallsChanged.mockClear();
  sendCallPush.mockClear();
  after.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  callRow = {
    id: "call-1",
    state: "RINGING",
    operator_id: "op-1",
    agora_channel_name: "call_abc",
    property_id: "prop-1",
  };
  callUpdateResult = [{ id: "call-1" }];
});

describe("POST /api/calls/[id]/answer-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
  });

  it("claims the call (IN_PROGRESS/handled_by) + ON_CALL, returns channelName", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).channelName).toBe("call_abc");
    expect(callUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "IN_PROGRESS", handled_by_user_id: "u1" }));
    expect(profileUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ON_CALL" }));
  });

  it("409 when already answered", async () => {
    callRow = { ...callRow!, state: "IN_PROGRESS" };
    expect((await call("call-1")).status).toBe(409);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("404 across operators", async () => {
    callRow = { ...callRow!, operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
  });

  it("403 when the caller is an OWNER (read-only role)", async () => {
    profileFetch.mockResolvedValueOnce({ data: { id: "u1", operator_id: "op-1", role: "OWNER" } });
    expect((await call("call-1")).status).toBe(403);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("409 when concurrent accept beats us (UPDATE returns 0 rows)", async () => {
    // callRow still shows RINGING so the read-check passes, but a concurrent
    // accept claimed it before our UPDATE — the DB returns no rows.
    callUpdateResult = [];
    const res = await call("call-1");
    expect(res.status).toBe(409);
    // The UPDATE was attempted — we lost the race, not the read-check.
    expect(callUpdateSpy).toHaveBeenCalled();
    // The loser must NOT stamp itself ON_CALL.
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("broadcasts calls-changed with the actor's operatorId on success", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("sends a call-cleared VIDEO push for the answered callId on success", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(sendCallPush).toHaveBeenCalledTimes(1);
    expect(sendCallPush).toHaveBeenCalledWith(
      expect.anything(),
      {
        type: "call-cleared",
        callId: "call-1",
        channel: "VIDEO",
        propertyId: "prop-1",
        propertyName: "",
      },
    );
  });

  it("403 (off duty) before any claim — the hard gate", async () => {
    const off = {
      data: {
        id: "u1",
        operator_id: "op-1",
        role: "AGENT",
        status: "OFFLINE",
        last_seen_at: new Date().toISOString(),
      },
    };
    // requireApiActor reads first (role AGENT passes), requireOnDuty reads
    // second (OFFLINE) -> 403 before fetchOperatorCall / claimCall.
    profileFetch.mockResolvedValueOnce(off).mockResolvedValueOnce(off);
    const res = await call("call-1");
    expect(res.status).toBe(403);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });
});
