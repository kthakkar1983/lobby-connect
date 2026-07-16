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
// Controls resetPresenceAfterCall's ownership query (this agent's OTHER live
// calls). Default empty — the reset proceeds ON_CALL -> AVAILABLE.
let otherActiveCalls: Array<{ id: string }> = [];
const callUpdateSpy = vi.fn();
// Tracks resetPresenceAfterCall's write (admin.from("profiles").update(...)),
// kept separate from callUpdateSpy so the existing "calls" table assertions
// stay meaningful now that every successful path also touches "profiles".
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(
  async (): Promise<{ data: Record<string, unknown> }> => ({
    data: { id: "u1", operator_id: "op-1", role: "AGENT" },
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => {
            profileUpdateSpy(v);
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      // Unified calls select chain serves two callers off one object:
      //   fetchOperatorCall              → .select().eq("id").maybeSingle() → callRow
      //   resetPresenceAfterCall ownership → .select("id").eq().in().limit() → otherActiveCalls
      return {
        select: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: Record<string, any> = {};
          chain.eq = () => chain;
          chain.in = () => chain;
          chain.limit = () => Promise.resolve({ data: otherActiveCalls });
          chain.maybeSingle = () => Promise.resolve({ data: callRow });
          return chain;
        },
        update: (v: unknown) => {
          callUpdateSpy(v);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/calls/[id]/end-video/route";

function call(id: string) {
  const request = new Request(`http://localhost:3000/api/calls/${id}/end-video`, { method: "POST" });
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
    state: "IN_PROGRESS",
    operator_id: "op-1",
    answered_at: "2026-06-06T06:00:00.000Z",
    property_id: "prop-1",
  };
  otherActiveCalls = [];
});

describe("POST /api/calls/[id]/end-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("finalizes an IN_PROGRESS call to COMPLETED with ended_at + duration", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "COMPLETED",
        ended_at: expect.any(String),
        duration_seconds: expect.any(Number),
      }),
    );
  });

  it("resets the actor's presence ON_CALL -> AVAILABLE on the IN_PROGRESS (inbound) path (task_71d65b0a)", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(profileUpdateSpy).toHaveBeenCalledWith({ status: "AVAILABLE" });
  });

  it("does NOT reset presence when the agent still has another live call (stays ON_CALL)", async () => {
    // The ended call is finalized above, but a concurrent live call (e.g. an
    // overlapping audio Twilio call) keeps the agent ON_CALL — resetPresenceAfterCall
    // is ownership-aware, so ending one call can't prematurely clear the other.
    otherActiveCalls = [{ id: "other-live-call" }];
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(callUpdateSpy).toHaveBeenCalled(); // the current call was still finalized
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("finalizes a RINGING call (outbound, never answered) to NO_ANSWER with a null duration", async () => {
    callRow = { ...callRow!, state: "RINGING", answered_at: null };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "NO_ANSWER",
        ended_at: expect.any(String),
        duration_seconds: null,
      }),
    );
  });

  it("resets the actor's presence ON_CALL -> AVAILABLE on the RINGING (outbound cancel/timeout) path (task_71d65b0a)", async () => {
    callRow = { ...callRow!, state: "RINGING", answered_at: null };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(profileUpdateSpy).toHaveBeenCalledWith({ status: "AVAILABLE" });
  });

  it("broadcasts but does NOT push on the RINGING path (a never-connected outbound call was never pushed)", async () => {
    callRow = { ...callRow!, state: "RINGING", answered_at: null };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    expect(sendCallPush).not.toHaveBeenCalled();
  });

  it("404 across operators", async () => {
    callRow = { ...callRow!, operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("is a no-op on the call row when already finalized (kiosk won the race), but still resets presence", async () => {
    callRow = { ...callRow!, state: "COMPLETED" };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    // Broadcast must fire only inside the IN_PROGRESS/RINGING guards, not on the no-op path.
    expect(broadcastCallsChanged).not.toHaveBeenCalled();
    // Push fires from the same guarded after() — must not fire on the no-op path.
    expect(sendCallPush).not.toHaveBeenCalled();
    // Presence reset is unconditional (task_71d65b0a): the calling agent is done
    // with the call either way, even when the row was already finalized by the
    // other side of the race.
    expect(profileUpdateSpy).toHaveBeenCalledWith({ status: "AVAILABLE" });
  });

  it("403 when the caller is an OWNER (read-only role)", async () => {
    profileFetch.mockResolvedValueOnce({ data: { id: "u1", operator_id: "op-1", role: "OWNER" } });
    expect((await call("call-1")).status).toBe(403);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("broadcasts calls-changed with the actor's operatorId on success", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("sends a call-cleared VIDEO push for the finalized callId on success", async () => {
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
});
