import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null = null;
let callRows: Array<Record<string, unknown>> = [];
let propertyRows: Array<{ id: string; name: string; timezone?: string | null }> = [];
let assignmentRows: Array<{ property_id: string }> = [];
let availabilityRows: Array<{ property_id: string }> = [];
const gteSpy = vi.fn();
const inSpy = vi.fn();
const eqSpy = vi.fn();
const callsQuerySpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      // property_assignments: select().eq().is()  -> assigned-primary properties
      if (table === "property_assignments") {
        return { select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: assignmentRows }) }) }) };
      }
      // admin_call_availability: select().eq().eq()  -> accepting-calls properties
      if (table === "admin_call_availability") {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: availabilityRows }) }) }) };
      }
      if (table === "properties") {
        return { select: () => ({ in: () => Promise.resolve({ data: propertyRows }) }) };
      }
      // calls: select().eq().eq().eq().eq().in().gte().order()
      callsQuerySpy();
      const chain = {
        eq: (col: string, val: string) => {
          eqSpy(col, val);
          return chain;
        },
        in: (col: string, vals: string[]) => {
          inSpy(col, vals);
          return chain;
        },
        gte: (col: string, val: string) => {
          gteSpy(col, val);
          return chain;
        },
        order: () => Promise.resolve({ data: callRows }),
      };
      return { select: () => chain };
    },
  }),
}));

import { GET } from "@/app/api/calls/incoming-video/route";

const request = new Request("http://localhost:3000/api/calls/incoming-video");

beforeEach(() => {
  getUser.mockReset();
  gteSpy.mockClear();
  inSpy.mockClear();
  eqSpy.mockClear();
  callsQuerySpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  // `status: "AVAILABLE"` = on shift. The `profiles` mock is shared by both reads:
  // requireApiActor (id/operator_id/role/active) AND the actor end-shift gate
  // (status). A non-OFFLINE status keeps the happy-path tests polling normally.
  profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "AVAILABLE" };
  // u1 is the assigned primary agent for prop-1, so the default happy-path tests
  // have a property in scope and the calls query runs.
  assignmentRows = [{ property_id: "prop-1" }];
  availabilityRows = [];
  callRows = [
    { id: "call-1", property_id: "prop-1", agora_channel_name: "call_abc", ring_started_at: "2026-06-01T00:00:00Z" },
  ];
  propertyRows = [{ id: "prop-1", name: "The Sample Hotel", timezone: "America/Chicago" }];
});

describe("GET /api/calls/incoming-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request)).status).toBe(401);
  });

  it("returns ringing video calls with property names merged", async () => {
    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({
      id: "call-1",
      channelName: "call_abc",
      propertyName: "The Sample Hotel",
    });
  });

  it("returns an empty list when none ringing", async () => {
    callRows = [];
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
  });

  it("includes the property timezone per call (D10 hotel-clock plumb)", async () => {
    const body = await (await GET(request)).json();
    expect(body.calls[0].timezone).toBe("America/Chicago");
  });

  it("403 when the caller is an OWNER (read-only role)", async () => {
    profileRow = { id: "u1", operator_id: "op-1", role: "OWNER" };
    expect((await GET(request)).status).toBe(403);
  });

  it("returns [] and skips the calls query when the actor has ended their shift (status OFFLINE)", async () => {
    // End shift silences video too: the agent's own open tab must stop ringing.
    profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "OFFLINE" };
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
    expect(callsQuerySpy).not.toHaveBeenCalled();
    expect(inSpy).not.toHaveBeenCalled();
  });

  it("returns [] and skips the calls query when the actor is not accepting calls (status AWAY)", async () => {
    // "Not accepting calls" (AWAY) silences video too — parity with audio, whose
    // reachable set excludes AWAY. The agent's own open tab must stop ringing.
    profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "AWAY" };
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
    expect(callsQuerySpy).not.toHaveBeenCalled();
    expect(inSpy).not.toHaveBeenCalled();
  });

  it("fails OPEN: an absent actor status (transient read failure) still rings normally", async () => {
    // The actor is on shift (assigned, active) but the status read comes back with no
    // status field (a DB blip). Only status==="OFFLINE" silences — a failed read must
    // NOT empty the response; the ringing-calls query must still run.
    profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true };
    const body = await (await GET(request)).json();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({ id: "call-1" });
    expect(callsQuerySpy).toHaveBeenCalled();
  });

  it("time-bounds the RINGING query so a phantom ring from a dead kiosk is dropped", async () => {
    await GET(request);
    expect(gteSpy).toHaveBeenCalledWith("ring_started_at", expect.any(String));
    const cutoffAgeMs = Date.now() - new Date(String(gteSpy.mock.calls[0]?.[1])).getTime();
    // ~10 min cutoff: well past the 120s ring window, well within the last hour.
    expect(cutoffAgeMs).toBeGreaterThan(5 * 60_000);
    expect(cutoffAgeMs).toBeLessThan(60 * 60_000);
  });

  // --- Scoping: the poll must surface a call only to the agents the audio path
  // would dial (assigned primary agent + admins accepting calls). Before this,
  // every logged-in agent/admin polled back EVERY ringing video call. ---

  it("scopes the query to the agent's assigned properties", async () => {
    await GET(request);
    expect(inSpy).toHaveBeenCalledWith("property_id", ["prop-1"]);
  });

  it("an agent assigned to no property never rings (and skips the calls query)", async () => {
    assignmentRows = [];
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
    expect(callsQuerySpy).not.toHaveBeenCalled();
    expect(inSpy).not.toHaveBeenCalled();
  });

  it("an admin sees video calls only for properties it is accepting calls for", async () => {
    profileRow = { id: "u1", operator_id: "op-1", role: "ADMIN" };
    assignmentRows = [];
    availabilityRows = [{ property_id: "prop-2" }];
    await GET(request);
    expect(inSpy).toHaveBeenCalledWith("property_id", ["prop-2"]);
  });

  it("an admin not accepting calls (covering off) and unassigned never rings", async () => {
    profileRow = { id: "u1", operator_id: "op-1", role: "ADMIN" };
    assignmentRows = [];
    availabilityRows = [];
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
    expect(callsQuerySpy).not.toHaveBeenCalled();
  });

  it("unions an admin's assigned and accepting-calls properties (deduped)", async () => {
    profileRow = { id: "u1", operator_id: "op-1", role: "ADMIN" };
    assignmentRows = [{ property_id: "prop-1" }];
    availabilityRows = [{ property_id: "prop-2" }, { property_id: "prop-1" }];
    await GET(request);
    const ids = inSpy.mock.calls[0]?.[1] as string[];
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(["prop-1", "prop-2"]));
  });

  it("an agent does not consult admin_call_availability (assignment only)", async () => {
    // availabilityRows would add prop-9, but an AGENT must ignore it.
    availabilityRows = [{ property_id: "prop-9" }];
    await GET(request);
    expect(inSpy).toHaveBeenCalledWith("property_id", ["prop-1"]);
  });

  // --- Security-critical: an agent-initiated OUTBOUND video call is RINGING too,
  // but it rings the KIOSK, not this agent. Without the direction filter the
  // agent's own outbound row would surface right back as an incoming call. The
  // mock's .eq() is a no-op, so lock the filter by asserting it was applied. ---

  it("filters the RINGING query to direction=INBOUND so an OUTBOUND row never rings the agent", async () => {
    await GET(request);
    expect(eqSpy).toHaveBeenCalledWith("direction", "INBOUND");
  });
});
