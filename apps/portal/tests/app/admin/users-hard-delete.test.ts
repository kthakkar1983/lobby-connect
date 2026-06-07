import { describe, it, expect, beforeEach, vi } from "vitest";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: () => requireRole() }));

const auditSpy = vi.fn();
vi.mock("@/lib/auth/audit", () => ({ logAuditEvent: (...a: unknown[]) => auditSpy(...(a as [])) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let targetRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: targetRow }) }) }),
      }),
    }),
}));

const deleteUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { deleteUser: (id: string) => deleteUser(id) } } }),
}));

import { hardDeleteUserAction } from "@/app/(admin)/admin/users/actions";

// Records the relative order of the delete call vs the audit write.
const order: string[] = [];

beforeEach(() => {
  order.length = 0;
  requireRole.mockReset();
  auditSpy.mockReset();
  deleteUser.mockReset();
  requireRole.mockResolvedValue({ id: "admin-1", operator_id: "op-1" });
  targetRow = { id: "u2", operator_id: "op-1", email: "bob@example.com", full_name: "Bob" };
  auditSpy.mockImplementation(() => {
    order.push("audit");
    return Promise.resolve();
  });
  deleteUser.mockImplementation(() => {
    order.push("delete");
    return Promise.resolve({ error: null });
  });
});

describe("hardDeleteUserAction", () => {
  it("audits only AFTER a successful delete", async () => {
    const res = await hardDeleteUserAction({ targetUserId: "u2", confirmEmail: "bob@example.com" });
    expect(res).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith("u2");
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.deleted", entityId: "u2" }),
    );
    expect(order).toEqual(["delete", "audit"]);
  });

  it("writes NO audit row and returns a deactivate hint when the delete fails (FK restrict)", async () => {
    deleteUser.mockImplementation(() => {
      order.push("delete");
      return Promise.resolve({ error: { message: "FK violation" } });
    });
    const res = await hardDeleteUserAction({ targetUserId: "u2", confirmEmail: "bob@example.com" });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/deactivate/i);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(order).toEqual(["delete"]);
  });

  it("aborts (no delete, no audit) when the email confirmation mismatches", async () => {
    const res = await hardDeleteUserAction({ targetUserId: "u2", confirmEmail: "wrong@example.com" });
    expect(res.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
