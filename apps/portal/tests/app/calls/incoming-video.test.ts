import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null = null;
let callRows: Array<Record<string, unknown>> = [];
let propertyRows: Array<{ id: string; name: string }> = [];
const gteSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      if (table === "properties") {
        return { select: () => ({ in: () => Promise.resolve({ data: propertyRows }) }) };
      }
      // calls: select().eq().eq().eq().gte().order()
      const chain = {
        eq: () => chain,
        gte: (col: string, val: string) => {
          gteSpy(col, val);
          return chain;
        },
        order: () => Promise.resolve({ data: callRows }),
      };
      return { select: () => chain };
    },
  }),
}));

import { GET } from "@/app/api/calls/incoming-video/route";

const request = new Request("http://localhost:3000/api/calls/incoming-video");

beforeEach(() => {
  getUser.mockReset();
  gteSpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRows = [
    { id: "call-1", property_id: "prop-1", agora_channel_name: "call_abc", ring_started_at: "2026-06-01T00:00:00Z" },
  ];
  propertyRows = [{ id: "prop-1", name: "The Sample Hotel" }];
});

describe("GET /api/calls/incoming-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request)).status).toBe(401);
  });

  it("returns ringing video calls with property names merged", async () => {
    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({
      id: "call-1",
      channelName: "call_abc",
      propertyName: "The Sample Hotel",
    });
  });

  it("returns an empty list when none ringing", async () => {
    callRows = [];
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
  });

  it("403 when the caller is an OWNER (read-only role)", async () => {
    profileRow = { id: "u1", operator_id: "op-1", role: "OWNER" };
    expect((await GET(request)).status).toBe(403);
  });

  it("time-bounds the RINGING query so a phantom ring from a dead kiosk is dropped", async () => {
    await GET(request);
    expect(gteSpy).toHaveBeenCalledWith("ring_started_at", expect.any(String));
    const cutoffAgeMs = Date.now() - new Date(String(gteSpy.mock.calls[0]?.[1])).getTime();
    // ~10 min cutoff: well past the 120s ring window, well within the last hour.
    expect(cutoffAgeMs).toBeGreaterThan(5 * 60_000);
    expect(cutoffAgeMs).toBeLessThan(60 * 60_000);
  });
});
