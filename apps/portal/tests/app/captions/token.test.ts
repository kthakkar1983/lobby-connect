import { describe, it, expect, beforeEach, vi } from "vitest";

vi.stubEnv("SPEECHMATICS_API_KEY", "sk_test_secret");

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }),
    }),
  }),
}));

const createJwt = vi.fn();
vi.mock("@speechmatics/auth", () => ({ createSpeechmaticsJWT: (...a: unknown[]) => createJwt(...a) }));

import { GET } from "@/app/api/captions/token/route";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1", role: "AGENT", active: true };
  createJwt.mockResolvedValue("fake.jwt.token");
});

describe("GET /api/captions/token", () => {
  it("AGENT: returns a token + expiry, never the raw API key", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("fake.jwt.token");
    expect(typeof body.expiresAt).toBe("number");
    expect(JSON.stringify(body)).not.toContain("sk_test_secret");
    // The mint used type 'rt' and the server-held key.
    expect(createJwt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rt", apiKey: "sk_test_secret" }),
    );
  });

  it("ADMIN: allowed", async () => {
    profileRow = { ...profileRow!, role: "ADMIN" };
    expect((await GET()).status).toBe(200);
  });

  it("OWNER: 403 (owners do not take calls)", async () => {
    profileRow = { ...profileRow!, role: "OWNER" };
    expect((await GET()).status).toBe(403);
  });

  it("deactivated user: 403", async () => {
    profileRow = { ...profileRow!, active: false };
    expect((await GET()).status).toBe(403);
  });

  it("no session: 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
  });

  it("missing API key: 503 (captions unavailable, no crash)", async () => {
    vi.stubEnv("SPEECHMATICS_API_KEY", "");
    expect((await GET()).status).toBe(503);
  });
});
