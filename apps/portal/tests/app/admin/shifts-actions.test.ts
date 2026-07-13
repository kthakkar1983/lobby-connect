import { describe, it, expect, beforeEach, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: () => requireRole(),
}));

const auditSpy = vi.fn();
vi.mock("@/lib/auth/audit", () => ({
  logAuditEvent: (...a: unknown[]) => auditSpy(...(a as [])),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type ShiftRow = {
  id: string;
  operator_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
} | null;

type ProfileRow = { id: string; operator_id: string } | null;

let shiftRow: ShiftRow = {
  id: "shift-1",
  operator_id: "op-1",
  user_id: "user-1",
  started_at: "2026-07-10T00:00:00.000Z",
  ended_at: "2026-07-10T08:00:00.000Z",
  ended_reason: "manual",
};
let profileRow: ProfileRow = { id: "user-1", operator_id: "op-1" };

const updateSpy = vi.fn();
const deleteSpy = vi.fn();
const insertSpy = vi.fn();
let insertResult: { data: { id: string } | null; error: unknown } = {
  data: { id: "new-shift-1" },
  error: null,
};

// createServerClient reads scoped by RLS: the initial "does this row belong
// to my operator" check before any write, mirroring admin/users/actions.ts.
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({
      from: (table: string) => {
        if (table === "shifts") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: shiftRow }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: profileRow }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table on supabase: ${table}`);
      },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "shifts") throw new Error(`Unexpected table on admin: ${table}`);
      return {
        update: (patch: unknown) => ({
          eq: (_c1: string, v1: string) => ({
            eq: (_c2: string, v2: string) => {
              updateSpy(patch, v1, v2);
              return Promise.resolve({ error: null });
            },
          }),
        }),
        delete: () => ({
          eq: (_c1: string, v1: string) => ({
            eq: (_c2: string, v2: string) => {
              deleteSpy(v1, v2);
              return Promise.resolve({ error: null });
            },
          }),
        }),
        insert: (row: unknown) => {
          insertSpy(row);
          return {
            select: () => ({
              single: () => Promise.resolve(insertResult),
            }),
          };
        },
      };
    },
  }),
}));

import {
  editShiftAction,
  deleteShiftAction,
  addShiftAction,
} from "@/app/(admin)/admin/shifts/actions";

const PAST_START = "2026-07-10T00:00:00.000Z";
const PAST_END = "2026-07-10T08:00:00.000Z";

beforeEach(() => {
  requireRole.mockReset();
  auditSpy.mockReset();
  updateSpy.mockReset();
  deleteSpy.mockReset();
  insertSpy.mockReset();
  requireRole.mockResolvedValue({ id: "admin-1", operator_id: "op-1" });
  shiftRow = {
    id: "shift-1",
    operator_id: "op-1",
    user_id: "user-1",
    started_at: PAST_START,
    ended_at: PAST_END,
    ended_reason: "manual",
  };
  profileRow = { id: "user-1", operator_id: "op-1" };
  insertResult = { data: { id: "new-shift-1" }, error: null };
});

describe("editShiftAction", () => {
  it("rejects invalid times before touching the DB", async () => {
    const res = await editShiftAction({
      id: "shift-1",
      started_at: "not-a-date",
      ended_at: null,
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/Start time/);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects end before start before touching the DB", async () => {
    const res = await editShiftAction({
      id: "shift-1",
      started_at: PAST_END,
      ended_at: PAST_START,
    });
    expect(res.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects a shift that doesn't belong to the actor's operator", async () => {
    shiftRow = { ...shiftRow!, operator_id: "other-op" };
    const res = await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(
      "Shift not found in your operator.",
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown shift", async () => {
    shiftRow = null;
    const res = await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res.ok).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updates times, stamps edited_by, and audits SHIFT_EDITED, scoped to id + operator", async () => {
    const res = await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res).toEqual({ ok: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [patch, idScope, opScope] = updateSpy.mock.calls[0]!;
    expect(idScope).toBe("shift-1");
    expect(opScope).toBe("op-1");
    expect(patch).toMatchObject({
      started_at: PAST_START,
      ended_at: PAST_END,
      edited_by: "admin-1",
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shift.edited",
        entityType: "shift",
        entityId: "shift-1",
      }),
    );
  });

  it("closing a previously-open shift via edit stamps ended_reason 'manual'", async () => {
    shiftRow = { ...shiftRow!, ended_at: null, ended_reason: null };
    await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    const patch = updateSpy.mock.calls[0]![0] as { ended_reason: string | null };
    expect(patch.ended_reason).toBe("manual");
  });

  it("editing an already-closed shift's times leaves its existing ended_reason alone", async () => {
    shiftRow = { ...shiftRow!, ended_reason: "lapsed" };
    await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    const patch = updateSpy.mock.calls[0]![0] as { ended_reason: string | null };
    expect(patch.ended_reason).toBe("lapsed");
  });

  it("re-opening a shift (ended_at -> null) clears ended_reason to null", async () => {
    await editShiftAction({
      id: "shift-1",
      started_at: PAST_START,
      ended_at: null,
    });
    const patch = updateSpy.mock.calls[0]![0] as { ended_reason: string | null };
    expect(patch.ended_reason).toBeNull();
  });
});

describe("deleteShiftAction", () => {
  it("rejects a shift that doesn't belong to the actor's operator", async () => {
    shiftRow = { ...shiftRow!, operator_id: "other-op" };
    const res = await deleteShiftAction({ id: "shift-1" });
    expect(res.ok).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown shift", async () => {
    shiftRow = null;
    const res = await deleteShiftAction({ id: "shift-1" });
    expect(res.ok).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("audits SHIFT_DELETED with the pre-delete snapshot, then deletes scoped to id + operator", async () => {
    const res = await deleteShiftAction({ id: "shift-1" });
    expect(res).toEqual({ ok: true });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shift.deleted",
        entityType: "shift",
        entityId: "shift-1",
        details: expect.objectContaining({
          user_id: "user-1",
          started_at: PAST_START,
          ended_at: PAST_END,
          ended_reason: "manual",
        }),
      }),
    );
    expect(deleteSpy).toHaveBeenCalledWith("shift-1", "op-1");

    // Hard-delete convention: audit fires before the delete call.
    const auditOrder = auditSpy.mock.invocationCallOrder[0]!;
    const deleteOrder = deleteSpy.mock.invocationCallOrder[0]!;
    expect(auditOrder).toBeLessThan(deleteOrder);
  });
});

describe("addShiftAction", () => {
  it("rejects invalid times before touching the DB", async () => {
    const res = await addShiftAction({
      user_id: "user-1",
      started_at: PAST_END,
      ended_at: PAST_START, // end before start
    });
    expect(res.ok).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects a user_id that doesn't belong to the actor's operator", async () => {
    profileRow = { id: "user-1", operator_id: "other-op" };
    const res = await addShiftAction({
      user_id: "user-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(
      "User not found in your operator.",
    );
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown user_id", async () => {
    profileRow = null;
    const res = await addShiftAction({
      user_id: "user-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res.ok).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("inserts with operator_id, ended_reason manual, edited_by, and audits SHIFT_CREATED_MANUAL with the new id", async () => {
    const res = await addShiftAction({
      user_id: "user-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res).toEqual({ ok: true });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        user_id: "user-1",
        started_at: PAST_START,
        ended_at: PAST_END,
        ended_reason: "manual",
        edited_by: "admin-1",
      }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "shift.created_manual",
        entityType: "shift",
        entityId: "new-shift-1",
        details: expect.objectContaining({
          user_id: "user-1",
          started_at: PAST_START,
          ended_at: PAST_END,
        }),
      }),
    );
  });

  it("surfaces the DB error and skips the audit when the insert fails", async () => {
    insertResult = { data: null, error: { message: "boom" } };
    const res = await addShiftAction({
      user_id: "user-1",
      started_at: PAST_START,
      ended_at: PAST_END,
    });
    expect(res.ok).toBe(false);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
