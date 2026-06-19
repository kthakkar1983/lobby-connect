import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

// admin client:
//   calls.select().eq().maybeSingle()                     — fetchOperatorCall lookup
//   calls.update().eq("id").eq("state","RINGING")
//         .select("id")                                   — claimCall (returns callUpdateResult)
//   profiles.select().eq().maybeSingle()                  — requireApiActor profile read
//   profiles.update().eq()                                — ON_CALL stamp
let callRow:
  | { id: string; state: string; operator_id: string; properties: { timezone: string } | null }
  | null = null;
// Controls what claimCall's .select("id") returns — default winner (one row).
let callUpdateResult: Array<{ id: string }> = [{ id: "c1" }];
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(async () => ({
  data: { id: "u1", operator_id: "op1", role: "AGENT", active: true },
}));

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => {
            profileUpdateSpy(v);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // calls table — update chain must expose .select("id") for claimCall
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
        update: (v: unknown) => {
          callUpdateSpy(v);
          return {
            eq: () => ({
              eq: () => ({
                select: () => Promise.resolve({ data: callUpdateResult, error: null }),
              }),
            }),
          };
        },
      };
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));

import { POST } from "@/app/api/twilio/voice/answered/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/twilio/voice/answered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  callUpdateSpy.mockClear();
  profileUpdateSpy.mockClear();
  callUpdateResult = [{ id: "c1" }];
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/twilio/voice/answered", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ callId: "c1" }))).status).toBe(401);
  });

  it("marks the call IN_PROGRESS + handled_by, self ON_CALL, and returns the property timeZone (winner)", async () => {
    callRow = {
      id: "c1",
      state: "RINGING",
      operator_id: "op1",
      properties: { timezone: "America/New_York" },
    };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ timeZone: "America/New_York" });
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "IN_PROGRESS", handled_by_user_id: "u1" }),
    );
    expect(callUpdateSpy.mock.calls[0]?.[0]).toHaveProperty("answered_at");
    expect(profileUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });

  it("409 + no write when the call is not RINGING (already answered)", async () => {
    callRow = { id: "c1", state: "IN_PROGRESS", operator_id: "op1", properties: null };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(409);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("404 when the call belongs to another operator", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "OTHER", properties: null };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(404);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("403 when the caller is an OWNER (read-only role)", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "op1", properties: null };
    profileFetch.mockResolvedValueOnce({
      data: { id: "u1", operator_id: "op1", role: "OWNER", active: true },
    });
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(403);
    expect(callUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("409 when concurrent accept beats us (claimCall returns 0 rows)", async () => {
    // callRow still shows RINGING — canAnswer fast-path passes — but a concurrent
    // accept claimed the row before our UPDATE lands. DB returns no rows.
    callRow = { id: "c1", state: "RINGING", operator_id: "op1", properties: null };
    callUpdateResult = [];
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(409);
    // The UPDATE was attempted (we lost the race, not the read-check).
    expect(callUpdateSpy).toHaveBeenCalled();
    // The loser must NOT stamp itself ON_CALL.
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });
});
