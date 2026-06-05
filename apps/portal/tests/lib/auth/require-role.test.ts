import { afterEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__redirect__:${url}`);
});

const getUserMock = vi.fn();
const fromMock = vi.fn();
const singleMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function mockProfileQuery(result: {
  data: { id: string; role: "AGENT" | "ADMIN" | "OWNER"; operator_id: string; active: boolean; must_change_password: boolean } | null;
  error: { message: string } | null;
}) {
  singleMock.mockResolvedValueOnce(result);
  fromMock.mockReturnValueOnce({
    select: () => ({
      eq: () => ({
        maybeSingle: singleMock,
      }),
    }),
  });
}

describe("requireRole", () => {
  it("redirects to /sign-in when there is no session", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to / when the user has a different role", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "AGENT", operator_id: "op-1", active: true, must_change_password: false },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("redirects to /sign-in when the profile is inactive", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "ADMIN", operator_id: "op-1", active: false, must_change_password: false },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/sign-in");
  });

  it("redirects to /onboarding when must_change_password is true", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "ADMIN", operator_id: "op-1", active: true, must_change_password: true },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/onboarding");
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  it("returns the profile when role matches and user is active", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "ADMIN", operator_id: "op-1", active: true, must_change_password: false },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    const profile = await requireRole("ADMIN");
    expect(profile).toEqual({
      id: "user-1",
      role: "ADMIN",
      operator_id: "op-1",
      active: true,
      must_change_password: false,
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
