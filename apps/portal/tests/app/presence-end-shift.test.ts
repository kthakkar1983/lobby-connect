import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

const {
  requireApiActor,
  updateSpy,
  eqSpy,
  updateResult,
  shiftsSelectEqSpy,
  shiftsUpdateSpy,
  shiftsUpdateEqSpy,
  breaksUpdateSpy,
  breaksUpdateEqSpy,
  callOrder,
  openShiftRow,
} = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  updateSpy: vi.fn(),
  eqSpy: vi.fn(),
  updateResult: { error: null as { message: string } | null },
  shiftsSelectEqSpy: vi.fn(),
  shiftsUpdateSpy: vi.fn(),
  shiftsUpdateEqSpy: vi.fn(),
  breaksUpdateSpy: vi.fn(),
  breaksUpdateEqSpy: vi.fn(),
  callOrder: [] as string[],
  openShiftRow: { current: null as { id: string; started_at: string } | null },
}));

vi.mock("@/lib/auth/api-actor", () => ({
  requireApiActor: (...args: unknown[]) => requireApiActor(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          // .update({ status: "OFFLINE" }).eq("id", actor.userId)
          update: (values: unknown) => {
            updateSpy(values);
            callOrder.push("profiles.update");
            return {
              eq: (col: string, val: string) => {
                eqSpy(col, val);
                return Promise.resolve(updateResult);
              },
            };
          },
        };
      }
      if (table === "shifts") {
        return {
          // closeOpenShiftForUser's lookup for an open shift.
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
          // the final close write, guarded first-writer-wins.
          update: (values: unknown) => {
            shiftsUpdateSpy(values);
            callOrder.push("shifts.update");
            return {
              eq: (col: string, val: string) => {
                shiftsUpdateEqSpy(col, val);
                return {
                  is: () => Promise.resolve({ error: null }),
                };
              },
            };
          },
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

import { POST } from "@/app/api/presence/end-shift/route";

const ACTOR = { userId: "u-1", operatorId: "op-1", role: "AGENT" as const };

beforeEach(() => {
  requireApiActor.mockReset();
  updateSpy.mockReset();
  eqSpy.mockReset();
  updateResult.error = null;
  shiftsSelectEqSpy.mockReset();
  shiftsUpdateSpy.mockReset();
  shiftsUpdateEqSpy.mockReset();
  breaksUpdateSpy.mockReset();
  breaksUpdateEqSpy.mockReset();
  callOrder.length = 0;
  openShiftRow.current = null;
  requireApiActor.mockResolvedValue(ACTOR);
});

describe("POST /api/presence/end-shift", () => {
  it("401 when unauthenticated (requireApiActor returns a 401 NextResponse)", async () => {
    requireApiActor.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST();
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(shiftsSelectEqSpy).not.toHaveBeenCalled();
  });

  it("204 and writes OFFLINE scoped to the caller's id", async () => {
    const res = await POST();
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ status: "OFFLINE" });
    expect(eqSpy).toHaveBeenCalledWith("id", "u-1");
  });

  it("500 when the update errors, and never attempts to close a shift", async () => {
    updateResult.error = { message: "boom" };
    const res = await POST();
    expect(res.status).toBe(500);
    // closeOpenShiftForUser must not even be reached on the early return.
    expect(shiftsSelectEqSpy).not.toHaveBeenCalled();
  });

  it("closes the open shift (ended_at + ended_reason='manual') scoped to the caller, after the profile write succeeds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-12T05:00:00.000Z"));
      openShiftRow.current = { id: "shift-1", started_at: "2026-07-12T00:00:00.000Z" };
      const nowIso = "2026-07-12T05:00:00.000Z";

      const res = await POST();

      expect(res.status).toBe(204);
      // The open-shift lookup is scoped to THIS caller, not some other id.
      expect(shiftsSelectEqSpy).toHaveBeenCalledWith("user_id", "u-1");
      // Both the break close and the shift close carry the exact endedAtIso
      // and the "manual" reason (a wrong kind, e.g. "auto", would instead
      // classify via duration and not produce "manual" here).
      expect(breaksUpdateSpy).toHaveBeenCalledWith({ ended_at: nowIso });
      expect(breaksUpdateEqSpy).toHaveBeenCalledWith("shift_id", "shift-1");
      expect(shiftsUpdateSpy).toHaveBeenCalledWith({
        ended_at: nowIso,
        ended_reason: "manual",
      });
      expect(shiftsUpdateEqSpy).toHaveBeenCalledWith("id", "shift-1");
      // The profile write must commit before the shift close is even
      // attempted, and the lookup must happen before the final write.
      expect(callOrder.indexOf("profiles.update")).toBeLessThan(
        callOrder.indexOf("shifts.select"),
      );
      expect(callOrder.indexOf("shifts.select")).toBeLessThan(
        callOrder.indexOf("shifts.update"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops (writes nothing to shifts/shift_breaks) when no shift is open", async () => {
    openShiftRow.current = null;
    const res = await POST();
    expect(res.status).toBe(204);
    expect(shiftsUpdateSpy).not.toHaveBeenCalled();
    expect(breaksUpdateSpy).not.toHaveBeenCalled();
  });
});
