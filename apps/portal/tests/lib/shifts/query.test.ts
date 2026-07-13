import { describe, it, expect } from "vitest";
import {
  parseTimesheetRange,
  shiftWindowEndMs,
  findShiftForEvent,
  bucketEventsByShift,
  assembleShiftRow,
  fetchTimesheet,
  type ShiftWindow,
} from "@/lib/shifts/query";

const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// parseTimesheetRange
// ---------------------------------------------------------------------------

describe("parseTimesheetRange", () => {
  const now = new Date("2026-07-12T15:30:00.000Z");

  it("defaults to the last 7 days (UTC start-of-day .. now)", () => {
    const range = parseTimesheetRange({}, now);
    expect(range.fromIso).toBe("2026-07-05T00:00:00.000Z");
    expect(range.toIso).toBe(now.toISOString());
    expect(range.label).toBe("Jul 5 – Jul 12, 2026");
  });

  it("accepts ?from/?to overrides", () => {
    const range = parseTimesheetRange(
      { from: "2026-06-01T00:00:00.000Z", to: "2026-06-08T12:00:00.000Z" },
      now,
    );
    expect(range.fromIso).toBe("2026-06-01T00:00:00.000Z");
    expect(range.toIso).toBe("2026-06-08T12:00:00.000Z");
    expect(range.label).toBe("Jun 1 – Jun 8, 2026");
  });

  it("falls back to the default when an override is unparseable", () => {
    const range = parseTimesheetRange({ from: "not-a-date", to: "also-not-a-date" }, now);
    expect(range.fromIso).toBe("2026-07-05T00:00:00.000Z");
    expect(range.toIso).toBe(now.toISOString());
  });

  it("accepts a from-only override (to still defaults to now)", () => {
    const range = parseTimesheetRange({ from: "2026-07-01T00:00:00.000Z" }, now);
    expect(range.fromIso).toBe("2026-07-01T00:00:00.000Z");
    expect(range.toIso).toBe(now.toISOString());
  });
});

// ---------------------------------------------------------------------------
// shiftWindowEndMs
// ---------------------------------------------------------------------------

describe("shiftWindowEndMs", () => {
  const now = 100_000_000;

  it("closed shift -> ended_at", () => {
    expect(shiftWindowEndMs(iso(5000), null, now)).toBe(5000);
  });

  it("open + fresh heartbeat -> now", () => {
    expect(shiftWindowEndMs(null, iso(now - 10_000), now)).toBe(now);
  });

  it("open + stale heartbeat -> last_seen_at (effective end)", () => {
    expect(shiftWindowEndMs(null, iso(now - 200_000), now)).toBe(now - 200_000);
  });

  it("open + no heartbeat at all -> now", () => {
    expect(shiftWindowEndMs(null, null, now)).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// findShiftForEvent / bucketEventsByShift
// ---------------------------------------------------------------------------

describe("findShiftForEvent", () => {
  const windows: ShiftWindow[] = [{ id: "shift-1", userId: "u1", startMs: 1000, endMs: 5000 }];

  it("a timestamp inside the window resolves to the shift", () => {
    expect(findShiftForEvent(windows, "u1", iso(2000))).toBe("shift-1");
  });

  it("a timestamp before the window is outside", () => {
    expect(findShiftForEvent(windows, "u1", iso(500))).toBeNull();
  });

  it("the window end is exclusive", () => {
    expect(findShiftForEvent(windows, "u1", iso(5000))).toBeNull();
  });

  it("a matching time for a different user is outside", () => {
    expect(findShiftForEvent(windows, "u2", iso(2000))).toBeNull();
  });
});

describe("bucketEventsByShift", () => {
  const windows: ShiftWindow[] = [{ id: "shift-1", userId: "u1", startMs: 1000, endMs: 5000 }];

  it("groups in-window events by shift and drops out-of-window ones", () => {
    const events = [
      { userId: "u1", atIso: iso(2000), tag: "in" },
      { userId: "u1", atIso: iso(9000), tag: "out" },
      { userId: "u2", atIso: iso(2000), tag: "other-user" },
    ];
    const result = bucketEventsByShift(windows, events);
    expect(result.size).toBe(1);
    expect(result.get("shift-1")).toEqual([{ userId: "u1", atIso: iso(2000), tag: "in" }]);
  });

  it("returns an empty map when nothing falls inside any window", () => {
    const result = bucketEventsByShift(windows, [{ userId: "u1", atIso: iso(9000) }]);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assembleShiftRow
// ---------------------------------------------------------------------------

describe("assembleShiftRow", () => {
  it("a closed shift: clocked = ended - started, talk = sum of durations, utilization derived", () => {
    const shift = {
      id: "shift-1",
      user_id: "user-1",
      started_at: iso(0),
      ended_at: iso(4 * 3600 * 1000), // 4h
      ended_reason: "manual" as const,
    };
    const calls = [{ duration_seconds: 600 }, { duration_seconds: 300 }];
    const profile = { full_name: "Ann", role: "AGENT", last_seen_at: null };
    const row = assembleShiftRow(shift, calls, 3, profile, Date.now());
    expect(row).toEqual({
      id: "shift-1",
      userId: "user-1",
      name: "Ann",
      role: "AGENT",
      startedAt: iso(0),
      endedAt: iso(4 * 3600 * 1000),
      endedReason: "manual",
      clockedSeconds: 4 * 3600,
      callCount: 2,
      talkSeconds: 900,
      remoteCount: 3,
      utilization: 6, // round(900/14400*100) = 6.25 -> 6
    });
  });

  it("an open-stale shift: effective end via computeClockedSeconds (last_seen_at)", () => {
    const now = 100_000_000;
    const shift = {
      id: "shift-2",
      user_id: "user-2",
      started_at: iso(0),
      ended_at: null,
      ended_reason: null,
    };
    const profile = { full_name: "Bo", role: "ADMIN", last_seen_at: iso(1_800_000) };
    const row = assembleShiftRow(shift, [{ duration_seconds: 180 }], 1, profile, now);
    expect(row.clockedSeconds).toBe(1800); // matches lifecycle.ts's own stale-shift test
    expect(row.endedAt).toBeNull();
    expect(row.endedReason).toBeNull();
    expect(row.callCount).toBe(1);
    expect(row.talkSeconds).toBe(180);
    expect(row.utilization).toBe(10); // round(180/1800*100) = 10
  });

  it("a missing profile degrades to a placeholder rather than throwing", () => {
    const shift = {
      id: "shift-3",
      user_id: "user-3",
      started_at: iso(0),
      ended_at: iso(3600_000),
      ended_reason: "lapsed" as const,
    };
    const row = assembleShiftRow(shift, [], 0, null, Date.now());
    expect(row.name).toBe("Unknown");
    expect(row.role).toBe("");
    expect(row.clockedSeconds).toBe(3600);
  });

  it("no calls/remote -> zeroed counts and 0% utilization", () => {
    const shift = {
      id: "shift-4",
      user_id: "user-4",
      started_at: iso(0),
      ended_at: iso(3600_000),
      ended_reason: "capped" as const,
    };
    const row = assembleShiftRow(shift, [], 0, { full_name: "Cy", role: "AGENT", last_seen_at: null }, Date.now());
    expect(row.callCount).toBe(0);
    expect(row.talkSeconds).toBe(0);
    expect(row.remoteCount).toBe(0);
    expect(row.utilization).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fetchTimesheet (orchestrator) — mocked chainable Supabase clients
// ---------------------------------------------------------------------------

type ChainResult = { data: unknown; error: unknown };

/** Minimal fake Supabase query builder: every filter method returns itself and
 *  the whole thing is thenable, matching real supabase-js chains where
 *  `await qb.select(...).eq(...)...` resolves without an explicit `.then()`. */
function makeChain(result: ChainResult, callLog?: unknown[][]) {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      callLog?.push([name, ...args]);
      return chain;
    };
  const chain = {
    select: record("select"),
    eq: record("eq"),
    gte: record("gte"),
    lte: record("lte"),
    in: record("in"),
    order: record("order"),
    then: (resolve: (v: ChainResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function makeSupabase(shiftsResult: ChainResult) {
  return {
    from: (table: string) => {
      if (table !== "shifts") throw new Error(`unexpected table on supabase: ${table}`);
      return makeChain(shiftsResult);
    },
  } as unknown as Parameters<typeof fetchTimesheet>[0];
}

function makeAdmin(
  results: { profiles: ChainResult; calls: ChainResult; audit: ChainResult },
  callLog?: unknown[][],
) {
  return {
    from: (table: string) => {
      if (table === "profiles") return makeChain(results.profiles, callLog);
      if (table === "calls") return makeChain(results.calls, callLog);
      if (table === "audit_logs") return makeChain(results.audit, callLog);
      throw new Error(`unexpected table on admin: ${table}`);
    },
  } as unknown as Parameters<typeof fetchTimesheet>[1];
}

const RANGE = { fromIso: "2026-07-09T00:00:00.000Z", toIso: "2026-07-12T00:00:00.000Z", label: "x" };

describe("fetchTimesheet", () => {
  it("returns [] without touching the admin client when there are no shifts in range", async () => {
    const supabase = makeSupabase({ data: [], error: null });
    const admin = makeAdmin({
      profiles: { data: null, error: new Error("should not be called") },
      calls: { data: null, error: new Error("should not be called") },
      audit: { data: null, error: new Error("should not be called") },
    });
    const rows = await fetchTimesheet(supabase, admin, "op-1", RANGE);
    expect(rows).toEqual([]);
  });

  it("assembles one row per shift, attributing calls/remote-connects by window and scoping by operator", async () => {
    const shift = {
      id: "shift-1",
      user_id: "user-1",
      started_at: "2026-07-10T00:00:00.000Z",
      ended_at: "2026-07-10T08:00:00.000Z",
      ended_reason: "manual",
    };
    const supabase = makeSupabase({ data: [shift], error: null });
    const callLog: unknown[][] = [];
    const admin = makeAdmin(
      {
        profiles: {
          data: [{ id: "user-1", full_name: "Dilnoza", role: "AGENT", last_seen_at: null }],
          error: null,
        },
        calls: {
          data: [
            // inside [00:00, 08:00) -> attributed
            { handled_by_user_id: "user-1", answered_at: "2026-07-10T01:00:00.000Z", duration_seconds: 300 },
            // outside the shift window -> excluded
            { handled_by_user_id: "user-1", answered_at: "2026-07-11T01:00:00.000Z", duration_seconds: 999 },
          ],
          error: null,
        },
        audit: {
          // A real Connect (counted) + a prewarm cache-warm (NOT counted), both
          // in-window. The client-side guard drops the prewarm even though this
          // mock returns both regardless of the PostgREST filter.
          data: [
            { actor_user_id: "user-1", created_at: "2026-07-10T02:00:00.000Z", details: { trigger: "connect" } },
            { actor_user_id: "user-1", created_at: "2026-07-10T02:05:00.000Z", details: { trigger: "prewarm" } },
          ],
          error: null,
        },
      },
      callLog,
    );

    const rows = await fetchTimesheet(supabase, admin, "op-1", RANGE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "user-1",
      name: "Dilnoza",
      role: "AGENT",
      clockedSeconds: 8 * 3600,
      callCount: 1,
      talkSeconds: 300,
      remoteCount: 1, // the connect row only; the prewarm is excluded
      endedReason: "manual",
    });

    // Query-shape spot checks: operator scoping + the completed/action/connect
    // filters this task's spec calls for.
    expect(callLog).toContainEqual(["eq", "operator_id", "op-1"]);
    expect(callLog).toContainEqual(["eq", "state", "COMPLETED"]);
    expect(callLog).toContainEqual(["eq", "action", "remote_access.credentials_issued"]);
    expect(callLog).toContainEqual(["eq", "details->>trigger", "connect"]);
  });

  it("counts only trigger:'connect' remote rows, never prewarm (even if the DB filter is bypassed)", async () => {
    const shift = {
      id: "shift-1",
      user_id: "user-1",
      started_at: "2026-07-10T00:00:00.000Z",
      ended_at: "2026-07-10T08:00:00.000Z",
      ended_reason: "manual",
    };
    const supabase = makeSupabase({ data: [shift], error: null });
    const admin = makeAdmin({
      profiles: {
        data: [{ id: "user-1", full_name: "Dilnoza", role: "AGENT", last_seen_at: null }],
        error: null,
      },
      calls: { data: [], error: null },
      audit: {
        // Two prewarms + one connect, all in-window. Only the connect counts.
        data: [
          { actor_user_id: "user-1", created_at: "2026-07-10T01:00:00.000Z", details: { trigger: "prewarm" } },
          { actor_user_id: "user-1", created_at: "2026-07-10T03:00:00.000Z", details: { trigger: "connect" } },
          { actor_user_id: "user-1", created_at: "2026-07-10T05:00:00.000Z", details: { trigger: "prewarm" } },
          // A malformed/legacy row with no trigger must not count either.
          { actor_user_id: "user-1", created_at: "2026-07-10T06:00:00.000Z", details: null },
        ],
        error: null,
      },
    });

    const rows = await fetchTimesheet(supabase, admin, "op-1", RANGE);
    expect(rows[0]!.remoteCount).toBe(1);
  });

  it("degrades to a placeholder profile and logs (not throws) on a partial read error", async () => {
    const shift = {
      id: "shift-2",
      user_id: "user-2",
      started_at: "2026-07-10T00:00:00.000Z",
      ended_at: "2026-07-10T01:00:00.000Z",
      ended_reason: "manual",
    };
    const supabase = makeSupabase({ data: [shift], error: null });
    const admin = makeAdmin({
      profiles: { data: null, error: { message: "boom" } },
      calls: { data: [], error: null },
      audit: { data: [], error: null },
    });
    const rows = await fetchTimesheet(supabase, admin, "op-1", RANGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Unknown");
    expect(rows[0]!.clockedSeconds).toBe(3600);
  });
});
