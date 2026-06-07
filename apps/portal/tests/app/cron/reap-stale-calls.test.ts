import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface UpdateRec {
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}
const callsUpdates: UpdateRec[] = [];
const selectFilters: Record<string, unknown> = {};
let inProgressRows: Array<Record<string, unknown>> = [];
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
      return builder;
    },
    // Both `.eq().eq()` (per-row) and `.eq().eq().lt()` (bulk) are awaited.
    then: (resolve: (v: unknown) => void) => {
      callsUpdates.push(rec);
      resolve({ error: null });
    },
  };
  return builder;
}

function selectChain() {
  const builder: Record<string, unknown> = {
    eq: (k: string, v: unknown) => {
      selectFilters[k] = v;
      return builder;
    },
    then: (resolve: (v: unknown) => void) => resolve({ data: inProgressRows }),
  };
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "operators") {
        return { select: () => Promise.resolve({ data: [{ id: "op-1" }] }) };
      }
      return {
        select: () => selectChain(),
        update: (payload: Record<string, unknown>) => updateChain(payload),
      };
    },
  }),
}));

import { GET } from "@/app/api/cron/reap-stale-calls/route";

function req(auth: string | undefined = "Bearer s3cret"): Request {
  return new Request("http://localhost:3000/api/cron/reap-stale-calls", {
    headers: auth ? { authorization: auth } : {},
  });
}

const fortyMinAgo = () => new Date(Date.now() - 40 * 60_000).toISOString();
const fiveMinAgo = () => new Date(Date.now() - 5 * 60_000).toISOString();
const twoHoursAgo = () => new Date(Date.now() - 120 * 60_000).toISOString();

beforeEach(() => {
  callsUpdates.length = 0;
  for (const k of Object.keys(selectFilters)) delete selectFilters[k];
  heartbeatSpy.mockClear();
  process.env.CRON_SECRET = "s3cret";
  inProgressRows = [{ id: "c1", created_at: fortyMinAgo(), answered_at: fortyMinAgo() }];
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/reap-stale-calls", () => {
  it("401 when the auth header is wrong", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(callsUpdates).toHaveLength(0);
  });

  it("401 when CRON_SECRET is unset (fails closed)", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req())).status).toBe(401);
    expect(callsUpdates).toHaveLength(0);
  });

  it("closes a stale IN_PROGRESS video call as FAILED with a computed duration", async () => {
    await GET(req());
    const inProgress = callsUpdates.find((u) => u.payload.state === "FAILED");
    expect(inProgress).toBeDefined();
    expect(inProgress!.payload.flagged_for_review).toBe(true);
    expect(inProgress!.payload.ended_at).toEqual(expect.any(String));
    expect(inProgress!.payload.duration_seconds).toBeGreaterThan(0);
    // race guard: conditional on still being IN_PROGRESS, targeted by id
    expect(inProgress!.filters).toMatchObject({ id: "c1", state: "IN_PROGRESS" });
    // candidate fetch was scoped to VIDEO + IN_PROGRESS
    expect(selectFilters).toMatchObject({ channel: "VIDEO", state: "IN_PROGRESS" });
  });

  it("does NOT close a recently-answered long call", async () => {
    inProgressRows = [{ id: "c2", created_at: twoHoursAgo(), answered_at: fiveMinAgo() }];
    await GET(req());
    expect(callsUpdates.find((u) => u.payload.state === "FAILED")).toBeUndefined();
  });

  it("computes a null duration when answered_at is null but created_at is stale", async () => {
    inProgressRows = [{ id: "c3", created_at: fortyMinAgo(), answered_at: null }];
    await GET(req());
    const inProgress = callsUpdates.find((u) => u.payload.state === "FAILED");
    expect(inProgress).toBeDefined();
    expect(inProgress!.payload.duration_seconds).toBeNull();
  });

  it("closes stale RINGING video calls as NO_ANSWER", async () => {
    await GET(req());
    const ringing = callsUpdates.find((u) => u.payload.state === "NO_ANSWER");
    expect(ringing).toBeDefined();
    expect(ringing!.filters.channel).toBe("VIDEO");
    expect(ringing!.filters).toHaveProperty("ring_started_at__lt");
  });

  it("self-reports cron liveness per operator", async () => {
    await GET(req());
    expect(heartbeatSpy).toHaveBeenCalledWith("op-1", "cron_reap_stale_calls");
  });
});
