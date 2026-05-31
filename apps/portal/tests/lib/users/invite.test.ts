import { afterEach, describe, expect, it, vi } from "vitest";

type Admin = ReturnType<typeof buildAdminMock>;

function buildAdminMock(opts: {
  existingProfile?: { id: string } | null;
  inviteResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingProfile ?? null,
    error: null,
  });
  const insert = vi
    .fn()
    .mockResolvedValue(opts.insertResult ?? { error: null });
  const eqEmail = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqEmail }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      // First call (pre-check) uses select; second call (insert) uses insert.
      return { select, insert };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const inviteUserByEmail = vi
    .fn()
    .mockResolvedValue(
      opts.inviteResult ?? {
        data: { user: { id: "user-new" } },
        error: null,
      },
    );
  const deleteUser = vi.fn().mockResolvedValue({ error: null });

  return {
    from,
    auth: { admin: { inviteUserByEmail, deleteUser } },
    _spies: { inviteUserByEmail, insert, deleteUser, maybeSingle },
  };
}

const REDIRECT_URL = "https://app.example.com/auth/callback?next=/onboarding";

afterEach(() => {
  vi.clearAllMocks();
});

describe("inviteUser", () => {
  it("returns an error if a profile with the same email already exists", async () => {
    const admin = buildAdminMock({
      existingProfile: { id: "user-existing" },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "x@example.com", full_name: "X", role: "AGENT" },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({
      ok: false,
      error: "A user with this email already exists.",
    });
    expect(admin._spies.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites and inserts profile on the happy path (AGENT gets twilio_identity)", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada Lovelace",
        role: "AGENT",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({ ok: true, userId: "user-new" });
    expect(admin._spies.inviteUserByEmail).toHaveBeenCalledWith(
      "ada@example.com",
      expect.objectContaining({
        redirectTo: REDIRECT_URL,
        data: { full_name: "Ada Lovelace", role: "AGENT" },
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
        active: true,
      }),
    );
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });

  it("invites OWNER with twilio_identity null", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "owner@example.com",
        full_name: "Olive Owner",
        role: "OWNER",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "OWNER",
        twilio_identity: null,
      }),
    );
  });

  it("rolls back the auth user when profile insert fails", async () => {
    const admin = buildAdminMock({
      insertResult: { error: { message: "duplicate twilio_identity" } },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada",
        role: "ADMIN",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Failed to create profile/);
    }
    expect(admin._spies.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("returns the Supabase invite error when invitation fails", async () => {
    const admin = buildAdminMock({
      inviteResult: {
        data: { user: null },
        error: { message: "rate limit exceeded" },
      },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada",
        role: "ADMIN",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to send invitation: rate limit exceeded",
    });
    expect(admin._spies.insert).not.toHaveBeenCalled();
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });
});
