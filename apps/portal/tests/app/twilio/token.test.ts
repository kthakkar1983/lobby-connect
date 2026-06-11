import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

// Table-aware mock: the seam (requireApiActor) reads id/operator_id/role from
// "profiles"; the route's second read reads id/twilio_identity from "profiles".
// Both use maybeSingle(), so the mock delegates all "profiles" calls to it.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
        };
      }
      // No other tables are read by this route; fallthrough is a safety net.
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
      };
    },
  }),
}));

const buildVoiceAccessToken = vi.fn((..._a: unknown[]) => "jwt-token");
vi.mock("@/lib/twilio/token", () => ({
  buildVoiceAccessToken: (...a: unknown[]) => buildVoiceAccessToken(...a),
}));

vi.mock("@/lib/twilio/config", () => ({
  getTwilioApiCredentials: () => ({
    accountSid: "AC1",
    apiKeySid: "SK1",
    apiKeySecret: "sec",
  }),
}));

import { GET } from "@/app/api/twilio/token/route";

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
  buildVoiceAccessToken.mockClear();
});

describe("GET /api/twilio/token", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  // 403 fires on the twilio_identity gate, not a role gate — any role without an
  // identity (e.g. an OWNER, who has no twilio_identity) is rejected here.
  it("403 when twilio_identity is absent", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: { id: "u1", operator_id: "op-1", role: "OWNER", twilio_identity: null },
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns a token + identity for a call-taker", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: { id: "u1", operator_id: "op-1", role: "AGENT", twilio_identity: "lc_u1" },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "jwt-token", identity: "lc_u1" });
    expect(buildVoiceAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "lc_u1", ttlSeconds: 3600 }),
    );
  });
});
