import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null;
let callRow: Record<string, unknown> | null;
let propertyRow: Record<string, unknown> | null;
// Result of the atomic claim UPDATE (`.is(emergency_conference_name, null).select()`).
// Default: this request wins the claim (one row returned).
let claimResult: { data: unknown[] | null; error: unknown };
const updateCalls: Record<string, unknown>[] = [];
const insertedIncidents: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      if (table === "calls") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
          update: (vals: Record<string, unknown>) => {
            updateCalls.push(vals);
            const builder: Record<string, unknown> = {};
            builder.eq = () => builder;
            builder.is = () => builder;
            // `.update(...).eq(...).is(...).select()` → the atomic claim result.
            builder.select = () => Promise.resolve(claimResult);
            // `.update(...).eq(...)` (no select) is awaited directly.
            (builder as { then: (r: (v: unknown) => void) => void }).then = (resolve) =>
              resolve({ error: null });
            return builder;
          },
        };
      }
      if (table === "properties") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }) }) };
      }
      // incidents
      return {
        insert: (vals: Record<string, unknown>) => {
          insertedIncidents.push(vals);
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

const auditSpy = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/auth/audit", () => ({ logAuditEvent: (...a: unknown[]) => auditSpy(...(a as [])) }));

const listMock = vi.fn();
const callUpdateMock = vi.fn((_sid: string, _args: unknown) => Promise.resolve({}));
const participantsCreateMock = vi.fn();
vi.mock("@/lib/twilio/client", () => ({
  getTwilioRestClient: () => ({
    calls: Object.assign((sid: string) => ({ update: (args: unknown) => callUpdateMock(sid, args) }), {
      list: (...a: unknown[]) => listMock(...a),
    }),
    conferences: (name: string) => ({ participants: { create: (args: unknown) => participantsCreateMock(name, args) } }),
  }),
}));
vi.mock("@/lib/twilio/config", () => ({
  getTwilioConfig: () => ({ accountSid: "AC", authToken: "tok", phoneNumber: "+1FALLBACK" }),
}));

import { POST } from "@/app/api/calls/[id]/emergency/route";

function call(id: string) {
  return POST(new Request(`http://localhost:3000/api/calls/${id}/emergency`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.stubEnv("EMERGENCY_DIAL_NUMBER", "933");
  updateCalls.length = 0;
  insertedIncidents.length = 0;
  auditSpy.mockClear();
  listMock.mockReset();
  callUpdateMock.mockClear();
  participantsCreateMock.mockReset();
  claimResult = { data: [{ id: "call-1" }], error: null };
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRow = {
    id: "call-1",
    operator_id: "op-1",
    property_id: "prop-1",
    channel: "AUDIO",
    state: "IN_PROGRESS",
    twilio_call_sid: "CAparent",
    handled_by_user_id: "u1",
    emergency_conference_name: null,
  };
  propertyRow = { routing_did: "+14058750410" };
  listMock.mockResolvedValue([{ sid: "CAagent", status: "in-progress" }]);
  participantsCreateMock.mockResolvedValue({ callSid: "CA933" });
});

describe("POST /api/calls/[id]/emergency", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
  });

  it("404 when the call belongs to another operator", async () => {
    callRow = { ...(callRow as object), operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
  });

  it("409 when the caller is not the handling agent", async () => {
    callRow = { ...(callRow as object), handled_by_user_id: "someone-else" };
    expect((await call("call-1")).status).toBe(409);
  });

  it("409 when the call is not in progress", async () => {
    callRow = { ...(callRow as object), state: "RINGING" };
    expect((await call("call-1")).status).toBe(409);
  });

  it("is idempotent when already in emergency (fast-path read)", async () => {
    callRow = { ...(callRow as object), emergency_conference_name: "emg-call-1" };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyActive).toBe(true);
    expect(participantsCreateMock).not.toHaveBeenCalled();
  });

  it("is idempotent under a double-tap: losing the claim race places no second 911", async () => {
    // Fast-path read saw NULL, but a concurrent request already claimed: the
    // guarded UPDATE returns zero rows.
    claimResult = { data: [], error: null };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyActive).toBe(true);
    expect(participantsCreateMock).not.toHaveBeenCalled();
    expect(callUpdateMock).not.toHaveBeenCalled();
  });

  it("503 when the claim write errors (no dial attempted)", async () => {
    claimResult = { data: null, error: { message: "db down" } };
    const res = await call("call-1");
    expect(res.status).toBe(503);
    expect(participantsCreateMock).not.toHaveBeenCalled();
  });

  it("happy path: claims, redirects agent leg, adds 933, logs incident + audit", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).agentRedirected).toBe(true);
    expect(updateCalls[0]).toMatchObject({ emergency_conference_name: "emg-call-1" });
    expect(callUpdateMock).toHaveBeenCalledWith("CAagent", expect.objectContaining({
      twiml: expect.stringContaining("<Conference"),
    }));
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ emergency_agent_call_sid: "CAagent" }),
    );
    expect(participantsCreateMock).toHaveBeenCalledWith("emg-call-1", { from: "+14058750410", to: "933" });
    expect(insertedIncidents[0]).toMatchObject({
      call_id: "call-1",
      triggered_by: "u1",
      severity: "HIGH",
      kind: "EMERGENCY_911",
      dispatched_to: "933",
      emergency_call_sid: "CA933",
      status: "OPEN",
    });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "trigger_emergency" }));
  });

  it("falls back to redirecting the guest parent when no agent leg is live", async () => {
    listMock.mockResolvedValue([{ sid: "CAagent", status: "completed" }]);
    await call("call-1");
    expect(callUpdateMock).toHaveBeenCalledWith("CAparent", expect.objectContaining({
      twiml: expect.stringContaining("<Conference"),
    }));
    expect(participantsCreateMock).toHaveBeenCalled();
    expect(callUpdateMock).not.toHaveBeenCalledWith("CAagent", expect.anything());
  });

  it("falls back to the guest parent when the agent-leg redirect throws", async () => {
    listMock.mockResolvedValue([{ sid: "CAagent", status: "in-progress" }]);
    callUpdateMock.mockImplementationOnce(() => Promise.reject(new Error("leg gone")));
    await call("call-1");
    expect(callUpdateMock).toHaveBeenCalledWith("CAparent", expect.objectContaining({
      twiml: expect.stringContaining("<Conference"),
    }));
    expect(participantsCreateMock).toHaveBeenCalled();
  });

  it("502 when adding the emergency leg fails", async () => {
    participantsCreateMock.mockRejectedValue(new Error("twilio boom"));
    const res = await call("call-1");
    expect(res.status).toBe(502);
    expect(insertedIncidents[0]).toMatchObject({ emergency_call_sid: null });
  });

  it("total dispatch failure with no agent leg clears the stamp (guest not stranded)", async () => {
    listMock.mockResolvedValue([{ sid: "CAagent", status: "completed" }]); // agent already gone
    participantsCreateMock.mockRejectedValue(new Error("twilio boom"));
    const res = await call("call-1");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.guestStranded).toBe(true);
    expect(body.agentRedirected).toBe(false);
    // stamp rolled back so /dial-result keeps the guest on the normal bridge
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ emergency_conference_name: null }),
    );
    expect(String(insertedIncidents[0]?.notes)).toContain("DISPATCH FAILED");
  });

  it("dispatch failure while the agent is in the conference keeps the bridge intact", async () => {
    listMock.mockResolvedValue([{ sid: "CAagent", status: "in-progress" }]);
    participantsCreateMock.mockRejectedValue(new Error("twilio boom"));
    const res = await call("call-1");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.agentRedirected).toBe(true);
    expect(body.guestStranded).toBe(false);
    // stamp NOT cleared — the agent is on the line and can relay verbally
    expect(updateCalls).not.toContainEqual(
      expect.objectContaining({ emergency_conference_name: null }),
    );
  });
});
