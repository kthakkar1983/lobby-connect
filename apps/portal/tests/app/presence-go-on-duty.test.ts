import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
let updateError: { message: string } | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "u1", operator_id: "op-1", role: "AGENT" },
                }),
            }),
          }),
          update: (v: unknown) => {
            updateSpy(v);
            return { eq: () => Promise.resolve({ error: updateError }) };
          },
        };
      }
      if (table === "shifts") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {};
    },
  }),
}));

import { POST } from "@/app/api/presence/go-on-duty/route";

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
  updateError = null;
});

describe("POST /api/presence/go-on-duty", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST()).status).toBe(401);
  });

  it("writes AVAILABLE + a fresh last_seen (the only OFFLINE→live transition)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST();
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).toHaveProperty("last_seen_at");
  });

  it("500 when the write fails", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    updateError = { message: "boom" };
    expect((await POST()).status).toBe(500);
  });
});
