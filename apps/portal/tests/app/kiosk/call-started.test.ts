import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

const broadcastCallsChanged = vi.fn();
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastCallsChanged: (...a: unknown[]) => broadcastCallsChanged(...a),
}));

// The broadcast must be scheduled via next/server `after()` (guaranteed
// post-response work), NOT a bare `void` — a detached fetch is not guaranteed to
// run before the serverless function freezes. The spy runs its callback so the
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

let propertyRow: { id: string; operator_id: string; active: boolean } | null = null;
let existingActiveRow: Record<string, unknown> | null = null;
let insertResult: { data: { id: string } | null; error: { code: string } | null } = {
  data: { id: "call-1" },
  error: null,
};
const insertSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
          }),
        };
      }
      // calls
      return {
        // dedup check: select().eq().eq().in().limit().maybeSingle()
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                limit: () => ({ maybeSingle: () => Promise.resolve({ data: existingActiveRow }) }),
              }),
            }),
          }),
        }),
        insert: (v: Record<string, unknown>) => {
          insertSpy(v);
          return {
            select: () => ({
              single: () => Promise.resolve(insertResult),
            }),
          };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/kiosk/call-started/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/call-started", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  insertSpy.mockClear();
  broadcastCallsChanged.mockClear();
  after.mockClear();
  propertyRow = { id: "prop-1", operator_id: "op-1", active: true };
  existingActiveRow = null;
  insertResult = { data: { id: "call-1" }, error: null };
});

describe("POST /api/kiosk/call-started", () => {
  it("401 without a token", async () => {
    expect((await req()) && (await POST(req())).status).toBe(401);
  });

  it("inserts a VIDEO/RINGING call and returns callId + channelName", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callId).toBe("call-1");
    expect(typeof body.channelName).toBe("string");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        property_id: "prop-1",
        channel: "VIDEO",
        state: "RINGING",
      }),
    );
    expect(insertSpy.mock.calls[0]?.[0]).toHaveProperty("agora_channel_name", body.channelName);
  });

  it("404 when the property is inactive", async () => {
    propertyRow = { id: "prop-1", operator_id: "op-1", active: false };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req(token))).status).toBe(404);
  });

  it("409 when a VIDEO call is already active for the property (one kiosk = one call)", async () => {
    existingActiveRow = { id: "live-call" };
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(409);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("409 when the insert fails with unique_violation (23505) — DB-level one-active-video guard (S8)", async () => {
    // Simulates a race: the check-then-insert fast-path passes, but the partial
    // unique index catches a concurrent insert and returns 23505 instead of a row.
    insertResult = { data: null, error: { code: "23505" } };
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already active");
  });

  it("broadcasts calls-changed with the property's operator_id on success", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(200);
    expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
    expect(after).toHaveBeenCalledTimes(1);
  });
});
