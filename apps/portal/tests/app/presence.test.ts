import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn((_v: unknown) => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update: (v: unknown) => updateSpy(v) }) }),
}));

import { POST } from "@/app/api/presence/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
});

describe("POST /api/presence", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ status: "AVAILABLE" }))).status).toBe(401);
  });

  it("400 on a non-live status (OFFLINE is cron-only)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect((await POST(req({ status: "OFFLINE" }))).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updates status + last_seen for the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AWAY" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).toHaveProperty("last_seen_at");
  });
});
