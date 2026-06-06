import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
const callUpdateSpy = vi.fn();
const profileFetch = vi.fn(async () => ({ data: { id: "u1", operator_id: "op-1" } }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
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
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  callRow = {
    id: "call-1",
    state: "IN_PROGRESS",
    operator_id: "op-1",
    answered_at: "2026-06-06T06:00:00.000Z",
  };
});

describe("POST /api/calls/[id]/end-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
    expect(callUpdateSpy).not.toHaveBeenCalled();
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

  it("404 across operators", async () => {
    callRow = { ...callRow!, operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when the call is already finalized (kiosk won the race)", async () => {
    callRow = { ...callRow!, state: "COMPLETED" };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });
});
