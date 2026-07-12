import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
let updateFilters: string[][] = [];
let refreshedRows: unknown[] = [{ id: "u1" }]; // what the D13 conditional update matches
let refreshError: { message: string } | null = null;
// The BREAK-preservation check (quality-review follow-up to Task 9) is a
// separate conditional UPDATE from the general refresh above — it writes
// only `{ last_seen_at }` (no `status` key), which is how this mock tells
// the two apart, so each can be driven independently in tests. Defaults to
// "no fresh BREAK row" so every pre-existing test is unaffected.
let breakPreserveRows: unknown[] = [];
let breakPreserveError: { message: string } | null = null;
function profilesUpdate(v: unknown) {
  updateSpy(v);
  const filters: string[] = [];
  updateFilters.push(filters);
  const isBreakPreserveWrite = typeof v === "object" && v !== null && !("status" in v);
  const chain = {
    eq: () => { filters.push("eq"); return chain; },
    neq: () => { filters.push("neq"); return chain; },
    gte: () => { filters.push("gte"); return chain; },
    lt: () => { filters.push("lt"); return chain; },
    select: () =>
      isBreakPreserveWrite
        ? Promise.resolve({ data: breakPreserveError ? null : breakPreserveRows, error: breakPreserveError })
        : Promise.resolve({ data: refreshError ? null : refreshedRows, error: refreshError }),
    // Unconditional writes (ON_CALL bypass, lapse-persist) are awaited directly.
    then: (onFulfilled: (v: { error: null }) => unknown) =>
      Promise.resolve({ error: null }).then(onFulfilled),
  };
  return chain;
}
// Rows the simulated `calls` query returns for the on-call lookup.
let videoCallRows: unknown[] = [];
// Spy to capture the .gte("answered_at", ...) call added by the S3 fix.
const gteSpy = vi.fn();
// D13 GET hydration: the duty-read row served when `select` is NOT the
// requireApiActor actor-columns query (matched on `cols.includes("role")`).
let dutyRow: { status: string; last_seen_at: string | null } | null = {
  status: "AVAILABLE",
  last_seen_at: new Date().toISOString(),
};
let dutyReadError: { message: string } | null = null;
// GET's shift-start lookup (Task 10): only queried when onDuty resolves true.
let openShiftForGet: { started_at: string } | null = { started_at: "2026-07-12T00:00:00.000Z" };
let shiftReadErrorForGet: { message: string } | null = null;
const shiftsSelectSpy = vi.fn();
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
          select: (cols: string) => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  cols.includes("role")
                    ? { data: { id: "u1", operator_id: "op-1", role: "AGENT" } }
                    : { data: dutyReadError ? null : dutyRow, error: dutyReadError },
                ),
            }),
          }),
          update: profilesUpdate,
        };
      }
      if (table === "shifts") {
        return {
          select: (cols: string) => {
            shiftsSelectSpy(cols);
            return {
              eq: () => ({
                is: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: openShiftForGet, error: shiftReadErrorForGet }),
                }),
              }),
            };
          },
        };
      }
      return { update: profilesUpdate };
    },
  }),
}));

import { POST, GET } from "@/app/api/presence/route";

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
  updateFilters = [];
  refreshedRows = [{ id: "u1" }];
  refreshError = null;
  breakPreserveRows = [];
  breakPreserveError = null;
  dutyRow = { status: "AVAILABLE", last_seen_at: new Date().toISOString() };
  dutyReadError = null;
  openShiftForGet = { started_at: "2026-07-12T00:00:00.000Z" };
  shiftReadErrorForGet = null;
  shiftsSelectSpy.mockClear();
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

describe("D13 duty gate (spec §3.4)", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("an allowed beat refreshes via a CONDITIONAL update (neq OFFLINE + gte cutoff)", async () => {
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    // updateFilters[0] is the BREAK-preservation check (runs first, no match by
    // default — see the "BREAK preservation" describe block below).
    expect(updateFilters[1]).toEqual(["eq", "neq", "gte"]);
  });

  it("a gated beat writes nothing live, persists the lapse, returns onDuty:false", async () => {
    refreshedRows = []; // the conditional update matched 0 rows — shift is over
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onDuty: false });
    // Calls: [0] BREAK-preservation check (no match), [1] general refresh (0
    // rows), [2] lapse-persist: SET status=OFFLINE only, staleness re-checked (.lt).
    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(updateSpy.mock.calls[2]?.[0]).toEqual({ status: "OFFLINE" });
    expect(updateFilters[2]).toEqual(["eq", "neq", "lt"]);
  });

  it("AWAY beats are gated identically", async () => {
    refreshedRows = [];
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onDuty: false });
  });

  it("ON_CALL bypasses the gate — unconditional write, 204", async () => {
    refreshedRows = []; // would gate an AVAILABLE beat
    const res = await POST(req({ status: "ON_CALL" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateFilters[0]).toEqual(["eq"]); // no conditional filters
  });

  it("a video-upgraded AVAILABLE beat also bypasses (resolved status is ON_CALL)", async () => {
    refreshedRows = [];
    videoCallRows = [{ id: "c1" }];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ON_CALL" }));
  });

  it("a DB error on the refresh FAILS OPEN — 204, no gate verdict, no lapse-persist", async () => {
    refreshError = { message: "boom" };
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    // [0] BREAK-preservation check (no match) + [1] the refresh itself; no
    // third (lapse-persist) update.
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });
});

describe("BREAK preservation (quality-review follow-up to Task 9)", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("an AVAILABLE beat does not clobber a fresh BREAK row — preserves BREAK, 204", async () => {
    breakPreserveRows = [{ id: "u1" }];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    // Only the preservation check ran — the general refresh must NOT have
    // fired, or it would have clobbered BREAK back to AVAILABLE.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]).toEqual({ last_seen_at: expect.any(String) });
    expect(updateFilters[0]).toEqual(["eq", "eq", "gte"]);
  });

  it("an AWAY beat does not clobber a fresh BREAK row — preserves BREAK, 204", async () => {
    breakPreserveRows = [{ id: "u1" }];
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("a stale BREAK row is not preserved — falls through to the normal gate", async () => {
    breakPreserveRows = []; // the .gte cutoff excludes a stale BREAK row
    refreshedRows = []; // the general refresh also gates (shift is over)
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ onDuty: false });
  });

  it("a live video call still bypasses via ON_CALL, even with a fresh BREAK row", async () => {
    breakPreserveRows = [{ id: "u1" }];
    videoCallRows = [{ id: "c1" }];
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ON_CALL" }));
    // The BREAK-preservation check is scoped to AVAILABLE/AWAY only, so a
    // video-upgraded ON_CALL beat never reaches it.
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("fails open on a DB error during the BREAK-preservation check", async () => {
    breakPreserveError = { message: "boom" };
    const res = await POST(req({ status: "AVAILABLE" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledTimes(1); // no further writes attempted
  });
});

describe("GET /api/presence (D13 hydration)", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
  });

  it("fresh AVAILABLE → on duty, accepting, not on break, includes shift start", async () => {
    expect(await (await GET()).json()).toEqual({
      onDuty: true,
      accepting: true,
      onBreak: false,
      shiftStartedAt: "2026-07-12T00:00:00.000Z",
    });
  });

  it("fresh AWAY → on duty, not accepting", async () => {
    dutyRow = { status: "AWAY", last_seen_at: new Date().toISOString() };
    expect(await (await GET()).json()).toEqual({
      onDuty: true,
      accepting: false,
      onBreak: false,
      shiftStartedAt: "2026-07-12T00:00:00.000Z",
    });
  });

  it("fresh BREAK → on duty, not accepting, onBreak true", async () => {
    dutyRow = { status: "BREAK", last_seen_at: new Date().toISOString() };
    expect(await (await GET()).json()).toEqual({
      onDuty: true,
      accepting: true,
      onBreak: true,
      shiftStartedAt: "2026-07-12T00:00:00.000Z",
    });
  });

  it("explicit OFFLINE → off duty (accepting defaults true), no shift lookup", async () => {
    dutyRow = { status: "OFFLINE", last_seen_at: new Date().toISOString() };
    expect(await (await GET()).json()).toEqual({
      onDuty: false,
      accepting: true,
      onBreak: false,
      shiftStartedAt: null,
    });
    expect(shiftsSelectSpy).not.toHaveBeenCalled();
  });

  it("lapsed shift (stale AVAILABLE) → off duty, no shift lookup", async () => {
    dutyRow = {
      status: "AVAILABLE",
      last_seen_at: new Date(Date.now() - 120_000).toISOString(),
    };
    expect(await (await GET()).json()).toEqual({
      onDuty: false,
      accepting: true,
      onBreak: false,
      shiftStartedAt: null,
    });
    expect(shiftsSelectSpy).not.toHaveBeenCalled();
  });

  it("missing row → off duty, accepting true", async () => {
    dutyRow = null;
    expect(await (await GET()).json()).toEqual({
      onDuty: false,
      accepting: true,
      onBreak: false,
      shiftStartedAt: null,
    });
  });

  it("onDuty but no open shift row → shiftStartedAt null", async () => {
    openShiftForGet = null;
    expect(await (await GET()).json()).toEqual({
      onDuty: true,
      accepting: true,
      onBreak: false,
      shiftStartedAt: null,
    });
  });

  it("a transient error reading the open shift fails open (shiftStartedAt null) but is logged", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    openShiftForGet = null;
    shiftReadErrorForGet = { message: "boom" };
    expect(await (await GET()).json()).toEqual({
      onDuty: true,
      accepting: true,
      onBreak: false,
      shiftStartedAt: null,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[presence] GET: open-shift read failed",
      shiftReadErrorForGet,
    );
    consoleErrorSpy.mockRestore();
  });

  it("a DB error on the duty read surfaces as 500 (client fails open on !res.ok)", async () => {
    dutyReadError = { message: "boom" };
    expect((await GET()).status).toBe(500);
  });
});
