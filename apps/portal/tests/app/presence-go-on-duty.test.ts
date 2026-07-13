import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
let updateError: { message: string } | null = null;
const shiftInsertSpy = vi.fn();
let shiftInsertError: { code?: string; message?: string } | null = null;
// Records the order profiles.update / shifts.insert actually fire in, so a
// test can assert the shift-open call happens strictly after the profile
// write succeeds (not before, not unconditionally).
const callOrder: string[] = [];
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
            callOrder.push("profiles.update");
            return { eq: () => Promise.resolve({ error: updateError }) };
          },
        };
      }
      if (table === "shifts") {
        return {
          // openShift now close-then-inserts: it looks up an existing open shift
          // first. Default = none open, so the close no-ops and the insert runs.
          select: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
            }),
          }),
          insert: (v: unknown) => {
            shiftInsertSpy(v);
            callOrder.push("shifts.insert");
            return Promise.resolve({ error: shiftInsertError });
          },
        };
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
  shiftInsertSpy.mockClear();
  shiftInsertError = null;
  callOrder.length = 0;
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

  it("opens a shift for the actor (userId, operatorId) after the profile write succeeds", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST();
    expect(res.status).toBe(204);
    expect(shiftInsertSpy).toHaveBeenCalledWith({
      user_id: "u1",
      operator_id: "op-1",
    });
    // profiles.update must complete before shifts.insert fires — not before,
    // not in parallel, not on a swapped/removed guard.
    expect(callOrder).toEqual(["profiles.update", "shifts.insert"]);
  });

  it("does not open a shift when the profile write fails", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    updateError = { message: "boom" };
    const res = await POST();
    expect(res.status).toBe(500);
    expect(shiftInsertSpy).not.toHaveBeenCalled();
  });

  it("still returns 204 when the shift insert errors (fail-open)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    shiftInsertError = { code: "500", message: "boom" };
    const res = await POST();
    expect(res.status).toBe(204);
    expect(shiftInsertSpy).toHaveBeenCalled();
  });
});
