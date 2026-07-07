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

// createServerClient isn't used by the remote-access actions, but the module
// imports it — stub it out so importing the actions file doesn't blow up.
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({}),
}));

type PropertyRow = { id: string; operator_id: string } | null;
type ExistingRow = {
  id?: string;
  peer_id: string;
  unattended_password: string;
} | null;

let propertyRow: PropertyRow = { id: "prop-1", operator_id: "op-1" };
let existingRow: ExistingRow = null;
const upsertSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: propertyRow }),
            }),
          }),
        };
      }
      if (table === "property_remote_access") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: existingRow }),
            }),
          }),
          upsert: (row: unknown, opts: unknown) => {
            upsertSpy(row, opts);
            return Promise.resolve({ error: null });
          },
          delete: () => ({
            eq: (_col: string, id: string) => {
              deleteSpy(id);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import {
  upsertRemoteAccessAction,
  deleteRemoteAccessAction,
} from "@/app/(admin)/admin/properties/actions";

beforeEach(() => {
  requireRole.mockReset();
  auditSpy.mockReset();
  upsertSpy.mockReset();
  deleteSpy.mockReset();
  requireRole.mockResolvedValue({ id: "admin-1", operator_id: "op-1" });
  propertyRow = { id: "prop-1", operator_id: "op-1" };
  existingRow = null;
});

describe("upsertRemoteAccessAction", () => {
  it("rejects an invalid peer id before touching the DB", async () => {
    const res = await upsertRemoteAccessAction("prop-1", "bad id!!", "goodpassword123");
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/RustDesk ID/);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid password before touching the DB", async () => {
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "short");
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/Password/);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("rejects a property that doesn't belong to the actor's operator", async () => {
    propertyRow = { id: "prop-1", operator_id: "other-op" };
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "goodpassword123");
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(
      "Property not found in your operator.",
    );
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown property", async () => {
    propertyRow = null;
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "goodpassword123");
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toBe(
      "Property not found in your operator.",
    );
  });

  it("audits UPDATED for a brand-new credential row (no prior row)", async () => {
    existingRow = null;
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "goodpassword123");
    expect(res).toEqual({ ok: true });
    expect(upsertSpy).toHaveBeenCalledWith(
      {
        property_id: "prop-1",
        operator_id: "op-1",
        peer_id: "123456789",
        unattended_password: "goodpassword123",
      },
      { onConflict: "property_id" },
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "remote_access.updated",
        entityType: "property",
        entityId: "prop-1",
        details: { peer_id: "123456789" },
      }),
    );
  });

  it("audits UPDATED when the peer_id changes (not a pure rotation)", async () => {
    existingRow = { peer_id: "111111111", unattended_password: "oldpassword12" };
    const res = await upsertRemoteAccessAction("prop-1", "222222222", "newpassword123");
    expect(res).toEqual({ ok: true });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remote_access.updated" }),
    );
  });

  it("audits ROTATED when only the password changes (peer_id unchanged)", async () => {
    existingRow = { peer_id: "123456789", unattended_password: "oldpassword12" };
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "newpassword123");
    expect(res).toEqual({ ok: true });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remote_access.rotated" }),
    );
  });

  it("audits UPDATED (not ROTATED) when nothing actually changed", async () => {
    existingRow = { peer_id: "123456789", unattended_password: "samepassword1" };
    const res = await upsertRemoteAccessAction("prop-1", "123456789", "samepassword1");
    expect(res).toEqual({ ok: true });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remote_access.updated" }),
    );
  });

  it("never puts the password in the audit details", async () => {
    await upsertRemoteAccessAction("prop-1", "123456789", "goodpassword123");
    const call = auditSpy.mock.calls[0]![0] as { details: Record<string, unknown> };
    expect(JSON.stringify(call.details)).not.toContain("goodpassword123");
    expect(call.details).toEqual({ peer_id: "123456789" });
  });

  it("trims the peer id before storing/auditing", async () => {
    await upsertRemoteAccessAction("prop-1", "  123456789  ", "goodpassword123");
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ peer_id: "123456789" }),
      expect.anything(),
    );
  });
});

describe("deleteRemoteAccessAction", () => {
  it("rejects a foreign/unknown property", async () => {
    propertyRow = null;
    const res = await deleteRemoteAccessAction("prop-1");
    expect(res.ok).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("is idempotent when no row exists", async () => {
    existingRow = null;
    const res = await deleteRemoteAccessAction("prop-1");
    expect(res).toEqual({ ok: true });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it("deletes and audits REMOVED with the peer_id when a row exists", async () => {
    existingRow = { peer_id: "123456789", unattended_password: "whatever123" };
    const res = await deleteRemoteAccessAction("prop-1");
    expect(res).toEqual({ ok: true });
    expect(deleteSpy).toHaveBeenCalledWith("prop-1");
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "remote_access.removed",
        entityType: "property",
        entityId: "prop-1",
        details: { peer_id: "123456789" },
      }),
    );
  });
});
