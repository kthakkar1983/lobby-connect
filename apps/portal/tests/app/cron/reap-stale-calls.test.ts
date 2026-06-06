import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface UpdateRec {
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}
const callsUpdates: UpdateRec[] = [];
const heartbeatSpy = vi.fn();

vi.mock("@/lib/health/heartbeat", () => ({
  recordHeartbeat: (...args: unknown[]) => {
    heartbeatSpy(...args);
    return Promise.resolve();
  },
}));

function updateChain(payload: Record<string, unknown>) {
  const rec: UpdateRec = { payload, filters: {} };
  const builder: Record<string, unknown> = {
    eq: (k: string, v: unknown) => {
      rec.filters[k] = v;
      return builder;
    },
    lt: (k: string, v: unknown) => {
      rec.filters[`${k}__lt`] = v;
      callsUpdates.push(rec);
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "operators") {
        return { select: () => Promise.resolve({ data: [{ id: "op-1" }] }) };
      }
      return { update: (payload: Record<string, unknown>) => updateChain(payload) };
    },
  }),
}));

import { GET } from "@/app/api/cron/reap-stale-calls/route";

function req(auth?: string): Request {
  return new Request("http://localhost:3000/api/cron/reap-stale-calls", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  callsUpdates.length = 0;
  heartbeatSpy.mockClear();
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/reap-stale-calls", () => {
  it("401 when CRON_SECRET set and auth header is wrong", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(callsUpdates).toHaveLength(0);
  });

  it("closes stale IN_PROGRESS video calls as FAILED (flagged for review)", async () => {
    await GET(req());
    const inProgress = callsUpdates.find((u) => u.filters.state === "IN_PROGRESS");
    expect(inProgress).toBeDefined();
    expect(inProgress!.filters.channel).toBe("VIDEO");
    expect(inProgress!.payload.state).toBe("FAILED");
    expect(inProgress!.payload.flagged_for_review).toBe(true);
    expect(inProgress!.payload.ended_at).toEqual(expect.any(String));
    expect(inProgress!.filters).toHaveProperty("answered_at__lt");
  });

  it("closes stale RINGING video calls as NO_ANSWER", async () => {
    await GET(req());
    const ringing = callsUpdates.find((u) => u.filters.state === "RINGING");
    expect(ringing).toBeDefined();
    expect(ringing!.filters.channel).toBe("VIDEO");
    expect(ringing!.payload.state).toBe("NO_ANSWER");
    expect(ringing!.payload.ended_at).toEqual(expect.any(String));
    expect(ringing!.filters).toHaveProperty("ring_started_at__lt");
  });

  it("never touches AUDIO rows (Twilio finalizes those server-side)", async () => {
    await GET(req());
    for (const u of callsUpdates) expect(u.filters.channel).toBe("VIDEO");
  });

  it("self-reports cron liveness per operator", async () => {
    await GET(req());
    expect(heartbeatSpy).toHaveBeenCalledWith("op-1", "cron_reap_stale_calls");
  });
});
