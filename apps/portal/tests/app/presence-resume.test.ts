import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

const {
  requireApiActor,
  updateSpy,
  eqSpy,
  gteSpy,
  updateResult,
  shiftsSelectEqSpy,
  breaksUpdateSpy,
  breaksUpdateEqSpy,
  callOrder,
  openShiftRow,
} = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  updateSpy: vi.fn(),
  eqSpy: vi.fn(),
  gteSpy: vi.fn(),
  // The gated conditional UPDATE resolves with `{ data, error }` (a `.select("id")`
  // tail) — `data` is the array of rows the conditional update actually matched.
  // Defaults to "the gate passed" (one matched row) so every pre-existing test
  // is unaffected; gate-failure tests override this to `[]`.
  updateResult: {
    data: [{ id: "u-1" }] as { id: string }[] | null,
    error: null as { message: string } | null,
  },
  shiftsSelectEqSpy: vi.fn(),
  breaksUpdateSpy: vi.fn(),
  breaksUpdateEqSpy: vi.fn(),
  callOrder: [] as string[],
  openShiftRow: { current: null as { id: string } | null },
}));

vi.mock("@/lib/auth/api-actor", () => ({
  requireApiActor: (...args: unknown[]) => requireApiActor(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          // .update({ status: "AVAILABLE", last_seen_at })
          //   .eq("id", userId).eq("status", "BREAK").gte("last_seen_at", cutoff)
          //   .select("id")
          update: (values: unknown) => {
            updateSpy(values);
            callOrder.push("profiles.update");
            const chain = {
              eq: (col: string, val: string) => {
                eqSpy(col, val);
                return chain;
              },
              gte: (col: string, val: string) => {
                gteSpy(col, val);
                return chain;
              },
              select: () => Promise.resolve(updateResult),
            };
            return chain;
          },
        };
      }
      if (table === "shifts") {
        return {
          // closeOpenBreak's lookup for an open shift.
          select: () => ({
            eq: (col: string, val: string) => {
              shiftsSelectEqSpy(col, val);
              callOrder.push("shifts.select");
              return {
                is: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: openShiftRow.current, error: null }),
                }),
              };
            },
          }),
        };
      }
      if (table === "shift_breaks") {
        return {
          update: (values: unknown) => {
            breaksUpdateSpy(values);
            callOrder.push("shift_breaks.update");
            return {
              eq: (col: string, val: string) => {
                breaksUpdateEqSpy(col, val);
                return {
                  is: () => Promise.resolve({ error: null }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/presence/resume/route";

const ACTOR = { userId: "u-1", operatorId: "op-1", role: "AGENT" as const };

beforeEach(() => {
  requireApiActor.mockReset();
  updateSpy.mockReset();
  eqSpy.mockReset();
  gteSpy.mockReset();
  updateResult.data = [{ id: "u-1" }];
  updateResult.error = null;
  shiftsSelectEqSpy.mockReset();
  breaksUpdateSpy.mockReset();
  breaksUpdateEqSpy.mockReset();
  callOrder.length = 0;
  openShiftRow.current = null;
  requireApiActor.mockResolvedValue(ACTOR);
});

describe("POST /api/presence/resume", () => {
  it("401 when unauthenticated (requireApiActor returns a 401 NextResponse)", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(shiftsSelectEqSpy).not.toHaveBeenCalled();
  });

  it("204 and writes AVAILABLE + a fresh last_seen scoped to the caller, gated on BREAK", async () => {
    const res = await POST();
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).toHaveProperty("last_seen_at");
    expect(eqSpy).toHaveBeenCalledWith("id", "u-1");
    expect(eqSpy).toHaveBeenCalledWith("status", "BREAK");
    expect(gteSpy).toHaveBeenCalledWith("last_seen_at", expect.any(String));
  });

  it("500 when the update errors, and never attempts to close a break", async () => {
    updateResult.data = null;
    updateResult.error = { message: "boom" };
    const res = await POST();
    expect(res.status).toBe(500);
    expect(shiftsSelectEqSpy).not.toHaveBeenCalled();
  });

  it("closes the open break for the caller's open shift after the profile write succeeds", async () => {
    openShiftRow.current = { id: "shift-1" };
    const res = await POST();
    expect(res.status).toBe(204);
    expect(shiftsSelectEqSpy).toHaveBeenCalledWith("user_id", "u-1");
    expect(breaksUpdateSpy).toHaveBeenCalledWith({ ended_at: expect.any(String) });
    expect(breaksUpdateEqSpy).toHaveBeenCalledWith("shift_id", "shift-1");
    expect(callOrder).toEqual([
      "profiles.update",
      "shifts.select",
      "shift_breaks.update",
    ]);
  });

  it("no-ops (writes nothing to shift_breaks) when no shift is open", async () => {
    openShiftRow.current = null;
    const res = await POST();
    expect(res.status).toBe(204);
    expect(breaksUpdateSpy).not.toHaveBeenCalled();
  });

  it("409s and never closes a break when the caller is not currently on break (gate matched zero rows)", async () => {
    // Simulates an OFFLINE/never-onduty/lapsed/not-on-break caller: the
    // conditional UPDATE's WHERE (status=BREAK + fresh heartbeat) matches nothing.
    updateResult.data = [];
    const res = await POST();
    expect(res.status).toBe(409);
    expect(shiftsSelectEqSpy).not.toHaveBeenCalled();
    expect(breaksUpdateSpy).not.toHaveBeenCalled();
  });
});
