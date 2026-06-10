import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
// Controls what the guarded UPDATE returns — default winner (one row claimed).
let callUpdateResult: Array<{ id: string }> = [{ id: "call-1" }];
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(
  async (): Promise<{ data: Record<string, unknown> }> => ({
    data: { id: "u1", operator_id: "op-1" },
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
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  callRow = { id: "call-1", state: "RINGING", operator_id: "op-1", agora_channel_name: "call_abc" };
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
});
