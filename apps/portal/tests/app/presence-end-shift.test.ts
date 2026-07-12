import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiActor, updateSpy, eqSpy, updateResult } = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  updateSpy: vi.fn(),
  eqSpy: vi.fn(),
  updateResult: { error: null as { message: string } | null },
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
        // closeOpenShiftForUser's lookup for an open shift — none open, so it no-ops.
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
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
  });

  it("204 and writes OFFLINE scoped to the caller's id", async () => {
    const res = await POST();
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ status: "OFFLINE" });
    expect(eqSpy).toHaveBeenCalledWith("id", "u-1");
  });

  it("500 when the update errors", async () => {
    updateResult.error = { message: "boom" };
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
