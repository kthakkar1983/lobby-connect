import { afterEach, describe, expect, it, vi } from "vitest";

function buildAdminMock(opts: {
  existingProfile?: { id: string } | null;
  createResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingProfile ?? null,
    error: null,
  });
  const insert = vi.fn().mockResolvedValue(opts.insertResult ?? { error: null });
  const eqEmail = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqEmail }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select, insert };
    throw new Error(`unexpected table ${table}`);
  });

  const createUser = vi.fn().mockResolvedValue(
    opts.createResult ?? { data: { user: { id: "user-new" } }, error: null },
  );
  const deleteUser = vi.fn().mockResolvedValue({ error: null });

  return {
    from,
    auth: { admin: { createUser, deleteUser } },
    _spies: { createUser, insert, deleteUser, maybeSingle },
  };
}
type Admin = ReturnType<typeof buildAdminMock>;

afterEach(() => vi.clearAllMocks());

describe("provisionUser", () => {
  it("rejects an email that already has a profile", async () => {
    const admin = buildAdminMock({ existingProfile: { id: "u-existing" } }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "x@example.com", full_name: "X", role: "AGENT", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: false, error: "A user with this email already exists." });
    expect(admin._spies.createUser).not.toHaveBeenCalled();
  });

  it("creates a confirmed user + profile with must_change_password true (AGENT gets twilio_identity)", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada Lovelace", role: "AGENT", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: true, userId: "user-new" });
    expect(admin._spies.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        password: "temp1234",
        email_confirm: true,
        user_metadata: { full_name: "Ada Lovelace", role: "AGENT" },
      }),
    );
    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-new",
        operator_id: "op-1",
        role: "AGENT",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        twilio_identity: "lc_usernew",
        must_change_password: true,
        active: true,
      }),
    );
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });

  it("creates OWNER with twilio_identity null", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "o@example.com", full_name: "Olive", role: "OWNER", tempPassword: "temp1234" },
    });
    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "OWNER", twilio_identity: null }),
    );
  });

  it("rolls back the auth user when profile insert fails", async () => {
    const admin = buildAdminMock({ insertResult: { error: { message: "dup twilio_identity" } } }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada", role: "ADMIN", tempPassword: "temp1234" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to create profile/);
    expect(admin._spies.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("returns the Supabase error when createUser fails", async () => {
    const admin = buildAdminMock({
      createResult: { data: { user: null }, error: { message: "weak password" } },
    }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada", role: "ADMIN", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: false, error: "Failed to create user: weak password" });
    expect(admin._spies.insert).not.toHaveBeenCalled();
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });
});
