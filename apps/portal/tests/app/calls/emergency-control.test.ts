import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null;
let callRow: Record<string, unknown> | null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      // calls
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }) };
    },
  }),
}));

const participantUpdateMock = vi.fn((_args?: unknown) => Promise.resolve({}));
const participantRemoveMock = vi.fn(() => Promise.resolve({}));
const participantsAccessor = vi.fn((_sid: string) => ({
  update: (args: unknown) => participantUpdateMock(args),
  remove: () => participantRemoveMock(),
}));
vi.mock("@/lib/twilio/client", () => ({
  getTwilioRestClient: () => ({
    conferences: (_name: string) => ({ participants: participantsAccessor }),
  }),
}));

import { POST } from "@/app/api/calls/[id]/emergency/control/route";

function call(id: string, body: unknown) {
  return POST(
    new Request(`http://localhost:3000/api/calls/${id}/emergency/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRow = {
    id: "call-1",
    operator_id: "op-1",
    state: "IN_PROGRESS",
    handled_by_user_id: "u1",
    emergency_conference_name: "emg-call-1",
    emergency_agent_call_sid: "CAagent",
  };
  participantUpdateMock.mockClear();
  participantRemoveMock.mockClear();
  participantsAccessor.mockClear();
});

describe("POST /api/calls/[id]/emergency/control", () => {
  it("400 on an invalid action", async () => {
    expect((await call("call-1", { action: "bogus" })).status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1", { action: "mute" })).status).toBe(401);
  });

  it("404 when the call is in another operator", async () => {
    callRow = { ...(callRow as object), operator_id: "OTHER" };
    expect((await call("call-1", { action: "mute" })).status).toBe(404);
  });

  it("403 when the caller is not the handling agent", async () => {
    callRow = { ...(callRow as object), handled_by_user_id: "other" };
    expect((await call("call-1", { action: "mute" })).status).toBe(403);
  });

  it("409 with no Twilio action when the call is not IN_PROGRESS", async () => {
    callRow = { ...(callRow as object), state: "COMPLETED" };
    const res = await call("call-1", { action: "mute" });
    expect(res.status).toBe(409);
    expect(participantsAccessor).not.toHaveBeenCalled();
    expect(participantUpdateMock).not.toHaveBeenCalled();
    expect(participantRemoveMock).not.toHaveBeenCalled();
  });

  it("409 when the call is not in an emergency conference", async () => {
    callRow = { ...(callRow as object), emergency_conference_name: null };
    expect((await call("call-1", { action: "mute" })).status).toBe(409);
  });

  it("200 no-op when there is no agent leg recorded", async () => {
    callRow = { ...(callRow as object), emergency_agent_call_sid: null };
    const res = await call("call-1", { action: "mute" });
    expect(res.status).toBe(200);
    expect((await res.json()).noAgentLeg).toBe(true);
    expect(participantUpdateMock).not.toHaveBeenCalled();
  });

  it("mutes the agent participant", async () => {
    const res = await call("call-1", { action: "mute" });
    expect(res.status).toBe(200);
    expect(participantsAccessor).toHaveBeenCalledWith("CAagent");
    expect(participantUpdateMock).toHaveBeenCalledWith({ muted: true });
  });

  it("unmutes the agent participant", async () => {
    await call("call-1", { action: "unmute" });
    expect(participantUpdateMock).toHaveBeenCalledWith({ muted: false });
  });

  it("removes the agent participant on leave", async () => {
    const res = await call("call-1", { action: "leave" });
    expect(res.status).toBe(200);
    expect(participantRemoveMock).toHaveBeenCalled();
  });

  it("502 when the Twilio call fails", async () => {
    participantUpdateMock.mockRejectedValueOnce(new Error("twilio boom"));
    expect((await call("call-1", { action: "mute" })).status).toBe(502);
  });
});
