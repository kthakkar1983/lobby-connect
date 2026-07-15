import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface UpdateRec {
  payload: Record<string, unknown>;
  filters: Record<string, unknown>;
}
interface SelectRec {
  fields: string;
  filters: Record<string, unknown>;
}
const callsUpdates: UpdateRec[] = [];
const callsSelects: SelectRec[] = [];
const presenceUpdateSpy = vi.fn();
let inProgressRows: Array<Record<string, unknown>> = [];
let ringingRows: Array<Record<string, unknown>> = [];
const heartbeatSpy = vi.fn();

vi.mock("@/lib/health/heartbeat", () => ({
  recordHeartbeat: (...args: unknown[]) => {
    heartbeatSpy(...args);
    return Promise.resolve();
  },
}));

// admin.from("calls").update(...) — every finalize write (FAILED / NO_ANSWER).
function callsUpdateChain(payload: Record<string, unknown>) {
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
    then: (resolve: (v: unknown) => void) => {
      callsUpdates.push(rec);
      resolve({ error: null });
    },
  };
  return builder;
}

// admin.from("calls").select(...) — the two sweeps' candidate fetches, keyed by
// the `state` filter each chain accumulates so IN_PROGRESS and RINGING each get
// served their own row set.
function callsSelectChain(fields: string) {
  const rec: SelectRec = { fields, filters: {} };
  const builder: Record<string, unknown> = {
    eq: (k: string, v: unknown) => {
      rec.filters[k] = v;
      return builder;
    },
    lt: (k: string, v: unknown) => {
      rec.filters[`${k}__lt`] = v;
      return builder;
    },
    then: (resolve: (v: unknown) => void) => {
      callsSelects.push(rec);
      const data = rec.filters.state === "IN_PROGRESS" ? inProgressRows : ringingRows;
      resolve({ data });
    },
  };
  return builder;
}

// admin.from("profiles").update(...) — resetPresenceAfterCall's write, real
// (unmocked) implementation, exercised end-to-end against this spy.
function profilesUpdateChain(payload: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return builder;
    },
    then: (resolve: (v: unknown) => void) => {
      presenceUpdateSpy(payload, filters);
      resolve({ error: null });
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
      if (table === "profiles") {
        return { update: (payload: Record<string, unknown>) => profilesUpdateChain(payload) };
      }
      return {
        select: (fields: string) => callsSelectChain(fields),
        update: (payload: Record<string, unknown>) => callsUpdateChain(payload),
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
  callsSelects.length = 0;
  presenceUpdateSpy.mockClear();
  heartbeatSpy.mockClear();
  process.env.CRON_SECRET = "s3cret";
  inProgressRows = [
    { id: "c1", created_at: fortyMinAgo(), answered_at: fortyMinAgo(), handled_by_user_id: "agent-1" },
  ];
  // Default outbound-shaped RINGING candidate: handled_by_user_id set at
  // creation (start-outbound-video), unlike an inbound ring (null until claimed).
  ringingRows = [{ id: "r1", handled_by_user_id: "agent-2" }];
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/reap-stale-calls", () => {
  it("401 when the auth header is wrong", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(callsUpdates).toHaveLength(0);
    expect(presenceUpdateSpy).not.toHaveBeenCalled();
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
    const inProgressSelect = callsSelects.find((s) => s.filters.state === "IN_PROGRESS");
    expect(inProgressSelect?.filters).toMatchObject({ channel: "VIDEO", state: "IN_PROGRESS" });
  });

  it("does NOT close a recently-answered long call", async () => {
    inProgressRows = [{ id: "c2", created_at: twoHoursAgo(), answered_at: fiveMinAgo(), handled_by_user_id: "agent-1" }];
    await GET(req());
    expect(callsUpdates.find((u) => u.payload.state === "FAILED")).toBeUndefined();
    // Not stale -> never finalized -> presence must not be touched for it either.
    expect(presenceUpdateSpy).not.toHaveBeenCalledWith(
      { status: "AVAILABLE" },
      expect.objectContaining({ id: "agent-1" }),
    );
  });

  it("computes a null duration when answered_at is null but created_at is stale", async () => {
    inProgressRows = [{ id: "c3", created_at: fortyMinAgo(), answered_at: null, handled_by_user_id: null }];
    await GET(req());
    const inProgress = callsUpdates.find((u) => u.payload.state === "FAILED");
    expect(inProgress).toBeDefined();
    expect(inProgress!.payload.duration_seconds).toBeNull();
  });

  it("closes stale RINGING video calls as NO_ANSWER", async () => {
    await GET(req());
    const ringing = callsUpdates.find((u) => u.payload.state === "NO_ANSWER");
    expect(ringing).toBeDefined();
    expect(ringing!.payload.duration_seconds).not.toBeDefined();
    // race guard: conditional on still being RINGING, targeted by id (mirrors the IN_PROGRESS sweep)
    expect(ringing!.filters).toMatchObject({ id: "r1", state: "RINGING" });
    // candidate fetch was scoped to VIDEO + RINGING + stale ring_started_at
    const ringingSelect = callsSelects.find((s) => s.filters.state === "RINGING");
    expect(ringingSelect?.filters.channel).toBe("VIDEO");
    expect(ringingSelect?.filters).toHaveProperty("ring_started_at__lt");
  });

  it("selects handled_by_user_id for both sweeps (needed for the presence reset)", async () => {
    await GET(req());
    const inProgressSelect = callsSelects.find((s) => s.filters.state === "IN_PROGRESS");
    const ringingSelect = callsSelects.find((s) => s.filters.state === "RINGING");
    expect(inProgressSelect?.fields).toContain("handled_by_user_id");
    expect(ringingSelect?.fields).toContain("handled_by_user_id");
  });

  it("resets presence ON_CALL -> AVAILABLE for the stale IN_PROGRESS row's handler (task_71d65b0a)", async () => {
    await GET(req());
    expect(presenceUpdateSpy).toHaveBeenCalledWith(
      { status: "AVAILABLE" },
      { id: "agent-1", status: "ON_CALL" },
    );
  });

  it("resets presence ON_CALL -> AVAILABLE for the stale RINGING row's handler — the outbound crash/throttle case (task_71d65b0a)", async () => {
    await GET(req());
    expect(presenceUpdateSpy).toHaveBeenCalledWith(
      { status: "AVAILABLE" },
      { id: "agent-2", status: "ON_CALL" },
    );
  });

  it("does not attempt a presence reset for an unclaimed inbound RINGING row (handled_by_user_id null)", async () => {
    ringingRows = [{ id: "r2", handled_by_user_id: null }];
    await GET(req());
    // resetPresenceAfterCall no-ops before ever touching the admin client on a
    // null userId, so the only presence write left is the IN_PROGRESS row's.
    expect(presenceUpdateSpy).toHaveBeenCalledTimes(1);
    expect(presenceUpdateSpy).toHaveBeenCalledWith(
      { status: "AVAILABLE" },
      { id: "agent-1", status: "ON_CALL" },
    );
  });

  it("self-reports cron liveness per operator", async () => {
    await GET(req());
    expect(heartbeatSpy).toHaveBeenCalledWith("op-1", "cron_reap_stale_calls");
  });
});
