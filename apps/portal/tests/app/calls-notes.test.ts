import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
// Mutable so individual tests can change the role returned by the profiles read.
let profileRole = "AGENT";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "u1", operator_id: "op-1", role: profileRole },
                }),
            }),
          }),
        };
      }
      return {
        update: (v: unknown) => {
          updateSpy(v);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/calls/notes/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/calls/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
  profileRole = "AGENT";
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/calls/notes", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ callId: "c1" }))).status).toBe(401);
  });

  it("400 without a callId", async () => {
    expect((await POST(req({ roomNumber: "204" }))).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("saves room_number + notes", async () => {
    const res = await POST(req({ callId: "c1", roomNumber: "204", notes: "lockout" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith({ room_number: "204", notes: "lockout" });
  });

  // OWNER is in the allow list for behavior-parity (route had no role gate before
  // the seam). The handled_by_user_id self-scope means an OWNER write matches no
  // rows (OWNERs never handle calls), making it a harmless 204 no-op.
  it("OWNER actor gets 204 (no-op: handled_by_user_id scope matches no rows)", async () => {
    profileRole = "OWNER";
    const res = await POST(req({ callId: "c1", roomNumber: "101", notes: "test" }));
    expect(res.status).toBe(204);
    // update is still called — the no-op is enforced by the handled_by_user_id
    // eq filter on the DB side, not by an early return in the route.
    expect(updateSpy).toHaveBeenCalledWith({ room_number: "101", notes: "test" });
  });
});
