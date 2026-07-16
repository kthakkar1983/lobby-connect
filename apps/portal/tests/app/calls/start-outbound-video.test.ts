import { describe, it, expect, beforeEach, vi } from "vitest";

// Drives requireApiActor's session read (mirrors the answer-video harness).
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const broadcastCallsChanged = vi.fn();
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastCallsChanged: (...a: unknown[]) => broadcastCallsChanged(...a),
}));

// The route imports NO push module — an outbound call must never push-ring. This
// spy stays uncalled to lock that intent (mocking a module the route never
// imports is a no-op, but the assertion documents the contract).
const sendCallPush = vi.fn();
vi.mock("@/lib/push/send", () => ({
  sendCallPush: (...a: unknown[]) => sendCallPush(...a),
}));

// The broadcast must be scheduled via next/server `after()` (guaranteed
// post-response work), NOT a bare `void`. The spy runs its callback so the
// broadcastCallsChanged assertions still hold.
const after = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after };
});

// requireApiActor reads id/operator_id/role/active; requireOnDuty reads status —
// a live shift keeps the hard gate open by default.
const profileFetch = vi.fn(
  async (): Promise<{ data: Record<string, unknown> | null; error: unknown }> => ({
    data: { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "AVAILABLE" },
    error: null,
  }),
);
const profileUpdateSpy = vi.fn();

let propertyRow: { id: string; operator_id: string; active: boolean } | null = null;
let existingActiveRows: Array<{ id: string }> = [];
let insertResult: { data: { id: string } | null; error: { code: string } | null } = {
  data: { id: "call-1" },
  error: null,
};
const insertSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
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
      if (table === "properties") {
        // Emulate the DB's WHERE id=? AND operator_id=?: return the row only when
        // BOTH filters match, so a wrong-operator lookup genuinely 404s.
        const filters: Record<string, string> = {};
        const chain = {
          eq: (col: string, val: string) => {
            filters[col] = val;
            return chain;
          },
          maybeSingle: () => {
            if (
              !propertyRow ||
              filters.id !== propertyRow.id ||
              filters.operator_id !== propertyRow.operator_id
            ) {
              return Promise.resolve({ data: null });
            }
            return Promise.resolve({ data: propertyRow });
          },
        };
        return { select: () => chain };
      }
      // calls: the already-on-a-call guard (select().eq().in().limit()) + the insert.
      return {
        select: () => ({
          eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: existingActiveRows }) }) }),
        }),
        insert: (v: Record<string, unknown>) => {
          insertSpy(v);
          return { select: () => ({ single: () => Promise.resolve(insertResult) }) };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/calls/start-outbound-video/route";

function post(body?: unknown) {
  return new Request("http://localhost:3000/api/calls/start-outbound-video", {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  profileFetch.mockClear();
  profileUpdateSpy.mockClear();
  insertSpy.mockClear();
  broadcastCallsChanged.mockClear();
  sendCallPush.mockClear();
  after.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileFetch.mockResolvedValue({
    data: { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "AVAILABLE" },
    error: null,
  });
  propertyRow = { id: "prop-1", operator_id: "op-1", active: true };
  existingActiveRows = [];
  insertResult = { data: { id: "call-1" }, error: null };
});

describe("POST /api/calls/start-outbound-video", () => {
  it("401 when unauthenticated (requireApiActor's NextResponse passthrough)", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(401);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("403 for a disallowed role (OWNER) — actor-gated to AGENT|ADMIN", async () => {
    profileFetch.mockResolvedValue({
      data: { id: "u1", operator_id: "op-1", role: "OWNER", active: true, status: "AVAILABLE" },
      error: null,
    });
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(403);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("403 (off duty) before any insert — the hard shift gate", async () => {
    // requireApiActor reads first (role AGENT passes), requireOnDuty reads second
    // (OFFLINE) -> 403 before the property lookup / insert.
    const off = {
      data: { id: "u1", operator_id: "op-1", role: "AGENT", active: true, status: "OFFLINE" },
      error: null,
    };
    profileFetch.mockResolvedValueOnce(off).mockResolvedValueOnce(off);
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(403);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("400 when the body has no propertyId", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("404 when the property does not exist", async () => {
    propertyRow = null;
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("404 when the property belongs to a different operator (no cross-operator origination)", async () => {
    propertyRow = { id: "prop-1", operator_id: "op-OTHER", active: true };
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("404 when the property is inactive", async () => {
    propertyRow = { id: "prop-1", operator_id: "op-1", active: false };
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(404);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("409 when the actor is already on a live call (one call at a time)", async () => {
    existingActiveRows = [{ id: "other-live-call" }];
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("You are already on a call");
    // Guard runs before the insert — no new RINGING row, no ON_CALL stamp.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("409 when the insert fails with unique_violation (23505) — the 0016 one-active index", async () => {
    insertResult = { data: null, error: { code: "23505" } };
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already active");
  });

  it("creates an OUTBOUND/RINGING VIDEO call, sets the actor ON_CALL, and returns {callId, channelName}", async () => {
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callId).toBe("call-1");
    expect(body.channelName).toMatch(/^call_[0-9a-f]{32}$/);

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        property_id: "prop-1",
        channel: "VIDEO",
        state: "RINGING",
        direction: "OUTBOUND",
        handled_by_user_id: "u1",
      }),
    );
    // The generated channel name is what's persisted and returned.
    expect(insertSpy.mock.calls[0]?.[0]).toHaveProperty("agora_channel_name", body.channelName);

    // The originating agent goes ON_CALL immediately.
    expect(profileUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ON_CALL" }));
  });

  it("broadcasts calls-changed with the actor's operatorId and sends NO push", async () => {
    const res = await POST(post({ propertyId: "prop-1" }));
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    expect(after).toHaveBeenCalledTimes(1);
    // An outbound call must never push-ring the agent who placed it.
    expect(sendCallPush).not.toHaveBeenCalled();
  });
});
