import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn((_v: unknown) => ({ eq: () => Promise.resolve({ error: null }) }));
// Rows the simulated `calls` query returns for the on-call lookup.
let videoCallRows: unknown[] = [];
// Spy to capture the .gte("answered_at", ...) call added by the S3 fix.
const gteSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "calls") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          gte: (...args: unknown[]) => { gteSpy(...args); return chain; },
          limit: () => Promise.resolve({ data: videoCallRows, error: null }),
        };
        return chain;
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "u1", operator_id: "op-1", role: "AGENT" },
                }),
            }),
          }),
          update: (v: unknown) => updateSpy(v),
        };
      }
      return { update: (v: unknown) => updateSpy(v) };
    },
  }),
}));

import { POST } from "@/app/api/presence/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
  gteSpy.mockClear();
  videoCallRows = [];
});

describe("POST /api/presence", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ status: "AVAILABLE" }))).status).toBe(401);
  });

  it("400 on a non-live status (OFFLINE is cron-only)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect((await POST(req({ status: "OFFLINE" }))).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updates status + last_seen for the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AWAY" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).toHaveProperty("last_seen_at");
  });

  it("writes ON_CALL (not AVAILABLE) when the caller is on a live video call", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [{ id: "c1" }];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });

  it("writes AVAILABLE when the caller has no live video call", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE" }),
    );
  });

  it("writes AWAY as-is without consulting the video-call check", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [{ id: "c1" }];
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AWAY" }),
    );
  });
});

describe("presence ON_CALL inference is time-bounded (S3)", () => {
  it("calls .gte('answered_at', ...) to bound the live-video query", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [];
    await POST(req({ status: "AVAILABLE" }));
    // The route must bound the live-video call query with a freshSince cutoff so
    // a leaked IN_PROGRESS row from a crashed kiosk cannot pin the agent ON_CALL
    // indefinitely (bug S3). Mirrors the bound in incoming-video/route.ts.
    expect(gteSpy).toHaveBeenCalledWith("answered_at", expect.any(String));
  });

  it("keeps AVAILABLE when no fresh live video call (stale row bounded out)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(gteSpy).toHaveBeenCalledWith("answered_at", expect.any(String));
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE" }),
    );
  });

  it("upgrades to ON_CALL when a fresh live video call exists", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    videoCallRows = [{ id: "c1" }];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });

  it("does not call .gte when status is AWAY (no video-call check)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await POST(req({ status: "AWAY" }));
    expect(gteSpy).not.toHaveBeenCalled();
  });
});
