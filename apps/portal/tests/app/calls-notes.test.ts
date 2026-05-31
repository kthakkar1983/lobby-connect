import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (v: unknown) => {
        updateSpy(v);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
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
});
