import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

const stampKioskLiveness = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/kiosk/stamp-liveness", () => ({
  stampKioskLiveness: (...a: unknown[]) => stampKioskLiveness(...a),
}));

// The liveness stamp must be scheduled via next/server `after()` (guaranteed
// post-response work), NOT a bare `void` — a detached fetch is not guaranteed to
// run before the serverless function freezes. The spy runs its callback so the
// stampKioskLiveness assertions still hold.
const after = vi.hoisted(() =>
  vi.fn((cb: () => unknown) => {
    void cb();
  }),
);
vi.mock("next/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after };
});

let callRow: Record<string, unknown> | null = null;
const eqSpy = vi.fn();
const gteSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // calls: select().eq().eq().eq().eq().gte().order().limit().maybeSingle()
    from: () => {
      const chain = {
        eq: (col: string, val: string) => {
          eqSpy(col, val);
          return chain;
        },
        gte: (col: string, val: string) => {
          gteSpy(col, val);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: callRow }),
      };
      return { select: () => chain };
    },
  }),
}));

import { GET } from "@/app/api/kiosk/incoming-call/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/incoming-call", {
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  stampKioskLiveness.mockClear();
  after.mockClear();
  eqSpy.mockClear();
  gteSpy.mockClear();
  callRow = null;
});

describe("GET /api/kiosk/incoming-call", () => {
  it("401 without a valid token", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("garbage"))).status).toBe(401);
  });

  it("returns null when no matching call is ringing", async () => {
    callRow = null;
    const res = await GET(req(signKioskToken("prop-1", SECRET)));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns callId + channelName when a RINGING OUTBOUND VIDEO call exists", async () => {
    callRow = { id: "call-1", agora_channel_name: "call_abc" };
    const res = await GET(req(signKioskToken("prop-1", SECRET)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ callId: "call-1", channelName: "call_abc" });
  });

  it("stamps kiosk liveness for the token's property on every poll, ringing or not", async () => {
    callRow = null;
    await GET(req(signKioskToken("prop-1", SECRET)));
    expect(after).toHaveBeenCalledTimes(1);
    expect(stampKioskLiveness).toHaveBeenCalledWith(expect.anything(), "prop-1");
  });

  it("does not stamp liveness on an invalid token", async () => {
    await GET(req("garbage"));
    expect(stampKioskLiveness).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  // --- Security/correctness: this poll must only ever surface a call that (a)
  // belongs to THIS kiosk's property, (b) is an agent-initiated OUTBOUND leg (an
  // INBOUND row is the guest's own kiosk-originated call, already handled by
  // call-started — surfacing it back here would be a self-ring loop), (c) is
  // still RINGING, and (d) is fresh (an expired ring must not resurface to a
  // kiosk that polled late). The mock's .eq()/.gte() are no-ops, so lock each
  // filter by asserting it was applied. ---

  it("scopes the query to the token's property, channel=VIDEO, direction=OUTBOUND, state=RINGING", async () => {
    await GET(req(signKioskToken("prop-1", SECRET)));
    expect(eqSpy).toHaveBeenCalledWith("property_id", "prop-1");
    expect(eqSpy).toHaveBeenCalledWith("channel", "VIDEO");
    expect(eqSpy).toHaveBeenCalledWith("direction", "OUTBOUND");
    expect(eqSpy).toHaveBeenCalledWith("state", "RINGING");
  });

  it("time-bounds the RINGING query to the outbound ring window so a stale ring can't resurface", async () => {
    await GET(req(signKioskToken("prop-1", SECRET)));
    expect(gteSpy).toHaveBeenCalledWith("ring_started_at", expect.any(String));
    const cutoffAgeMs = Date.now() - new Date(String(gteSpy.mock.calls[0]?.[1])).getTime();
    // OUTBOUND_RING_WINDOW_MS is 30s — the cutoff should be that far in the past.
    expect(cutoffAgeMs).toBeGreaterThan(20_000);
    expect(cutoffAgeMs).toBeLessThan(60_000);
  });
});
