import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

// admin client: calls.select(...).eq(...).maybeSingle() for the lookup;
// calls.update(...).eq(...).eq(...) and profiles.update(...).eq(...) for writes.
let callRow: { id: string; state: string; operator_id: string } | null = null;
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(async () => ({
  data: { id: "u1", operator_id: "op1", role: "AGENT" },
}));

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => {
            profileUpdateSpy(v);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // calls
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
        update: (v: unknown) => {
          callUpdateSpy(v);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));

import { POST } from "@/app/api/twilio/voice/answered/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/twilio/voice/answered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  callUpdateSpy.mockClear();
  profileUpdateSpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/twilio/voice/answered", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ callId: "c1" }))).status).toBe(401);
  });

  it("marks the call IN_PROGRESS + handled_by + answered_at, and self ON_CALL", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "op1" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(204);
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "IN_PROGRESS",
        handled_by_user_id: "u1",
      }),
    );
    expect(callUpdateSpy.mock.calls[0]?.[0]).toHaveProperty("answered_at");
    expect(profileUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });

  it("409 + no write when the call is not RINGING (already answered)", async () => {
    callRow = { id: "c1", state: "IN_PROGRESS", operator_id: "op1" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(409);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("404 when the call belongs to another operator", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "OTHER" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(404);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });
});
