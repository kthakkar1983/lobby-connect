import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { getSessionProfile } from "@/lib/auth/session";

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
});

describe("getSessionProfile", () => {
  it("returns null when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionProfile()).toBeNull();
  });

  it("returns the full profile shape (incl. full_name + email)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: {
        id: "u1", role: "AGENT", operator_id: "op1", active: true,
        must_change_password: false, full_name: "Alex Agent", email: "alex@x.com",
      },
    });
    const p = await getSessionProfile();
    expect(p).toMatchObject({ id: "u1", role: "AGENT", full_name: "Alex Agent", email: "alex@x.com" });
  });
});
