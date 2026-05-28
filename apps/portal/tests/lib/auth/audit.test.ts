import { afterEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const singleMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "profiles") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: singleMock,
        }),
      }),
    };
  }
  if (table === "audit_logs") {
    return { insert: insertMock };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("logAuditEvent", () => {
  it("inserts a row with the resolved operator_id and provided fields", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logAuditEvent } = await import("@/lib/auth/audit");

    await logAuditEvent({
      actorUserId: "user-1",
      action: "property.created",
      entityType: "property",
      entityId: "prop-9",
      details: { name: "Test Inn" },
    });

    expect(insertMock).toHaveBeenCalledWith({
      operator_id: "op-1",
      actor_user_id: "user-1",
      actor_type: "USER",
      action: "property.created",
      entity_type: "property",
      entity_id: "prop-9",
      details: { name: "Test Inn" },
    });
  });

  it("skips the insert if the actor profile cannot be resolved", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: null });
    const { logAuditEvent } = await import("@/lib/auth/audit");

    await logAuditEvent({
      actorUserId: "ghost",
      action: "user.signed_in",
      entityType: "user",
      entityId: "ghost",
    });

    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("logSignIn", () => {
  it("writes a user.signed_in row", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logSignIn } = await import("@/lib/auth/audit");

    await logSignIn("user-1");

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        actor_user_id: "user-1",
        actor_type: "USER",
        action: "user.signed_in",
        entity_type: "user",
        entity_id: "user-1",
      }),
    );
  });
});

describe("logSignOut", () => {
  it("writes a user.signed_out row", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logSignOut } = await import("@/lib/auth/audit");

    await logSignOut("user-1");

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.signed_out",
        actor_user_id: "user-1",
      }),
    );
  });
});
