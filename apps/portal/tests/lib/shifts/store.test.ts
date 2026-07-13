import { describe, it, expect, vi, beforeEach } from "vitest";
import { SESSION_MAX_MS, MAX_SHIFT_MS } from "@lc/shared";
import {
  openShift,
  closeOpenShiftForUser,
  openBreak,
  closeOpenBreak,
  capOverlongShifts,
} from "@/lib/shifts/store";

type Admin = Parameters<typeof openShift>[0];

type QueryError = { code?: string; message?: string } | null;

/**
 * Build a minimal fake admin client. Each table gets its own scripted result
 * for the operation store.ts actually performs on it:
 *   - select:  .select(...).eq(col,val).is(col,val).maybeSingle() -> { data }
 *   - insert:  .insert(values) -> { error }               (awaited directly)
 *   - update:  .update(values).eq(col,val).is(col,val) -> { error } (awaited, chained)
 * Spies record what was written AND the scoping args passed to eq()/is() on
 * both the select and update chains, so tests can assert on the guards
 * (row-scoping, first-writer-wins) and not just the write payloads.
 */
function mockAdmin(script: {
  select?: Record<string, unknown>;
  insert?: Record<string, { error: QueryError }>;
  update?: Record<string, { error: QueryError }>;
}) {
  const insertSpy = vi.fn();
  const updateSpy = vi.fn();
  const selectEqSpy = vi.fn();
  const selectIsSpy = vi.fn();
  const updateEqSpy = vi.fn();
  const updateIsSpy = vi.fn();

  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          selectEqSpy(table, col, val);
          return {
            is: (col2: string, val2: unknown) => {
              selectIsSpy(table, col2, val2);
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: script.select?.[table] ?? null }),
              };
            },
          };
        },
      }),
      insert: (values: unknown) => {
        insertSpy(table, values);
        return Promise.resolve(script.insert?.[table] ?? { error: null });
      },
      update: (values: unknown) => {
        updateSpy(table, values);
        return {
          eq: (col: string, val: unknown) => {
            updateEqSpy(table, col, val);
            return {
              is: (col2: string, val2: unknown) => {
                updateIsSpy(table, col2, val2);
                return Promise.resolve(script.update?.[table] ?? { error: null });
              },
            };
          },
        };
      },
    }),
  } as unknown as Admin;

  return { admin, insertSpy, updateSpy, selectEqSpy, selectIsSpy, updateEqSpy, updateIsSpy };
}

const USER_ID = "user-1";
const OPERATOR_ID = "op-1";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("openShift", () => {
  it("inserts a shift for the user+operator", async () => {
    const { admin, insertSpy } = mockAdmin({});
    await openShift(admin, USER_ID, OPERATOR_ID, null);
    expect(insertSpy).toHaveBeenCalledWith("shifts", {
      user_id: USER_ID,
      operator_id: OPERATOR_ID,
    });
  });

  it("swallows a 23505 unique violation (already open)", async () => {
    const { admin } = mockAdmin({
      insert: { shifts: { error: { code: "23505" } } },
    });
    await expect(openShift(admin, USER_ID, OPERATOR_ID, null)).resolves.toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs (but does not throw) on a non-23505 insert error", async () => {
    const { admin } = mockAdmin({
      insert: { shifts: { error: { code: "500", message: "boom" } } },
    });
    await expect(openShift(admin, USER_ID, OPERATOR_ID, null)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("closes a stale-open shift at the prior last activity BEFORE inserting a fresh one", async () => {
    // Regression (whole-branch review): a machine that slept / tabs closed with
    // no final beat leaves a shift open. Go on duty must close-then-insert, not
    // re-enter the old shift (which would merge the off-duty gap into clocked time).
    const started = "2026-07-12T00:00:00.000Z";
    const priorLastSeen = "2026-07-12T02:00:00.000Z";
    const { admin, insertSpy, updateSpy } = mockAdmin({
      select: { shifts: { id: "old-shift", started_at: started } },
    });

    await openShift(admin, USER_ID, OPERATOR_ID, priorLastSeen);

    // The lingering shift is closed at the agent's REAL last activity, not now.
    expect(updateSpy).toHaveBeenCalledWith("shifts", {
      ended_at: priorLastSeen,
      ended_reason: "lapsed",
    });
    // ...then a fresh shift is inserted.
    expect(insertSpy).toHaveBeenCalledWith("shifts", {
      user_id: USER_ID,
      operator_id: OPERATOR_ID,
    });
  });
});

describe("closeOpenShiftForUser", () => {
  it("no-ops when no open shift", async () => {
    const { admin, updateSpy } = mockAdmin({ select: { shifts: null } });
    await closeOpenShiftForUser(admin, USER_ID, "2026-07-12T10:00:00.000Z", "manual");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("manual close sets ended_reason='manual' and closes open break", async () => {
    const { admin, updateSpy, selectEqSpy, selectIsSpy, updateEqSpy, updateIsSpy } = mockAdmin({
      select: { shifts: { id: "shift-1", started_at: "2026-07-12T00:00:00.000Z" } },
    });
    const endedAtIso = "2026-07-12T01:00:00.000Z";

    await closeOpenShiftForUser(admin, USER_ID, endedAtIso, "manual");

    expect(updateSpy).toHaveBeenCalledWith("shift_breaks", { ended_at: endedAtIso });
    expect(updateSpy).toHaveBeenCalledWith("shifts", {
      ended_at: endedAtIso,
      ended_reason: "manual",
    });

    // The open-shift lookup is scoped to this user and to open rows only.
    expect(selectEqSpy).toHaveBeenCalledWith("shifts", "user_id", USER_ID);
    expect(selectIsSpy).toHaveBeenCalledWith("shifts", "ended_at", null);
    // The break close is scoped to this shift's open break (first-writer-wins).
    expect(updateEqSpy).toHaveBeenCalledWith("shift_breaks", "shift_id", "shift-1");
    expect(updateIsSpy).toHaveBeenCalledWith("shift_breaks", "ended_at", null);
    // The final shifts close is scoped to this shift and guarded open-only
    // (first-writer-wins) — dropping either guard must fail this assertion.
    expect(updateEqSpy).toHaveBeenCalledWith("shifts", "id", "shift-1");
    expect(updateIsSpy).toHaveBeenCalledWith("shifts", "ended_at", null);
  });

  it("auto close classifies 'capped' when the duration lands at the session cap", async () => {
    const startedAtIso = "2026-07-12T00:00:00.000Z";
    const endedAtIso = new Date(Date.parse(startedAtIso) + SESSION_MAX_MS).toISOString();
    const { admin, updateSpy } = mockAdmin({
      select: { shifts: { id: "shift-1", started_at: startedAtIso } },
    });

    await closeOpenShiftForUser(admin, USER_ID, endedAtIso, "auto");

    expect(updateSpy).toHaveBeenCalledWith("shifts", {
      ended_at: endedAtIso,
      ended_reason: "capped",
    });
  });

  it("auto close classifies 'lapsed' when the duration is well short of the session cap", async () => {
    const startedAtIso = "2026-07-12T00:00:00.000Z";
    const endedAtIso = new Date(Date.parse(startedAtIso) + 60 * 60 * 1000).toISOString();
    const { admin, updateSpy } = mockAdmin({
      select: { shifts: { id: "shift-1", started_at: startedAtIso } },
    });

    await closeOpenShiftForUser(admin, USER_ID, endedAtIso, "auto");

    expect(updateSpy).toHaveBeenCalledWith("shifts", {
      ended_at: endedAtIso,
      ended_reason: "lapsed",
    });
  });

  it("logs (but does not throw) when the shift_breaks close errors", async () => {
    const { admin } = mockAdmin({
      select: { shifts: { id: "shift-1", started_at: "2026-07-12T00:00:00.000Z" } },
      update: { shift_breaks: { error: { code: "500", message: "boom" } } },
    });
    await expect(
      closeOpenShiftForUser(admin, USER_ID, "2026-07-12T01:00:00.000Z", "manual"),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("logs (but does not throw) when the final shifts close errors", async () => {
    const { admin } = mockAdmin({
      select: { shifts: { id: "shift-1", started_at: "2026-07-12T00:00:00.000Z" } },
      update: { shifts: { error: { code: "500", message: "boom" } } },
    });
    await expect(
      closeOpenShiftForUser(admin, USER_ID, "2026-07-12T01:00:00.000Z", "manual"),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe("openBreak / closeOpenBreak", () => {
  it("openBreak inserts a shift_breaks row for the open shift", async () => {
    const { admin, insertSpy, selectEqSpy, selectIsSpy } = mockAdmin({
      select: { shifts: { id: "shift-1" } },
    });
    await openBreak(admin, USER_ID);
    expect(insertSpy).toHaveBeenCalledWith("shift_breaks", { shift_id: "shift-1" });
    expect(selectEqSpy).toHaveBeenCalledWith("shifts", "user_id", USER_ID);
    expect(selectIsSpy).toHaveBeenCalledWith("shifts", "ended_at", null);
  });

  it("openBreak no-ops when no open shift", async () => {
    const { admin, insertSpy } = mockAdmin({ select: { shifts: null } });
    await openBreak(admin, USER_ID);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("closeOpenBreak stamps ended_at on the open break, scoped to this shift's open break", async () => {
    const { admin, updateSpy, selectEqSpy, selectIsSpy, updateEqSpy, updateIsSpy } = mockAdmin({
      select: { shifts: { id: "shift-1" } },
    });
    const endedAtIso = "2026-07-12T02:00:00.000Z";
    await closeOpenBreak(admin, USER_ID, endedAtIso);
    expect(updateSpy).toHaveBeenCalledWith("shift_breaks", { ended_at: endedAtIso });
    expect(selectEqSpy).toHaveBeenCalledWith("shifts", "user_id", USER_ID);
    expect(selectIsSpy).toHaveBeenCalledWith("shifts", "ended_at", null);
    expect(updateEqSpy).toHaveBeenCalledWith("shift_breaks", "shift_id", "shift-1");
    expect(updateIsSpy).toHaveBeenCalledWith("shift_breaks", "ended_at", null);
  });

  it("closeOpenBreak no-ops when no open shift", async () => {
    const { admin, updateSpy } = mockAdmin({ select: { shifts: null } });
    await closeOpenBreak(admin, USER_ID, "2026-07-12T02:00:00.000Z");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("closeOpenBreak logs (but does not throw) when the break close errors", async () => {
    const { admin } = mockAdmin({
      select: { shifts: { id: "shift-1" } },
      update: { shift_breaks: { error: { code: "500", message: "boom" } } },
    });
    await expect(
      closeOpenBreak(admin, USER_ID, "2026-07-12T02:00:00.000Z"),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

/**
 * Dedicated mock for capOverlongShifts. It flips OFFLINE FIRST (the gate) and only
 * closes the shift + break if the flip took, so the chains are:
 *   - over-cap scan:  shifts.select(...).is("ended_at",null).lt("started_at",iso)      -> { data:[], error }
 *   - OFFLINE flip:   profiles.update({status}).eq("id",uid).neq("status","ON_CALL").select("id") -> { data:[], error }
 *   - open-break read: shift_breaks.select("id,started_at").eq("shift_id",id).is("ended_at",null).maybeSingle() -> { data, error }
 *   - break close:    shift_breaks.update({ended_at}).eq("id",breakId).is("ended_at",null) -> { error }
 *   - shift close:    shifts.update(...).eq("id",id).is("ended_at",null)                -> { error }
 * `flipped` defaults to one row (she was not ON_CALL, so the close proceeds); pass
 * `flipped: []` to model an ON_CALL agent whom the cap must SKIP entirely.
 */
function capMockAdmin(script: {
  overCap?: Array<{ id: string; user_id: string; started_at: string }>;
  scanError?: QueryError;
  flipped?: Array<{ id: string }>;
  flipError?: QueryError;
  openBreak?: { id: string; started_at: string } | null;
  breakCloseError?: QueryError;
  shiftUpdateError?: QueryError;
}) {
  const ltSpy = vi.fn();
  const shiftUpdateSpy = vi.fn();
  const shiftUpdateEqSpy = vi.fn();
  const shiftUpdateIsSpy = vi.fn();
  const breakSelectEqSpy = vi.fn();
  const breakSelectIsSpy = vi.fn();
  const breakUpdateSpy = vi.fn();
  const breakUpdateEqSpy = vi.fn();
  const breakUpdateIsSpy = vi.fn();
  const profileUpdateSpy = vi.fn();
  const profileEqSpy = vi.fn();
  const profileNeqSpy = vi.fn();

  const flipped = script.flipped === undefined ? [{ id: "flipped-user" }] : script.flipped;
  const openBreak = script.openBreak ?? null;

  const admin = {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            is: () => ({
              lt: (col: string, val: string) => {
                ltSpy(col, val);
                return Promise.resolve({
                  data: script.overCap ?? [],
                  error: script.scanError ?? null,
                });
              },
            }),
          }),
          update: (values: unknown) => {
            shiftUpdateSpy(values);
            return {
              eq: (col: string, val: unknown) => {
                shiftUpdateEqSpy(col, val);
                return {
                  is: (col2: string, val2: unknown) => {
                    shiftUpdateIsSpy(col2, val2);
                    return Promise.resolve({ error: script.shiftUpdateError ?? null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "shift_breaks") {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              breakSelectEqSpy(col, val);
              return {
                is: (col2: string, val2: unknown) => {
                  breakSelectIsSpy(col2, val2);
                  return { maybeSingle: () => Promise.resolve({ data: openBreak, error: null }) };
                },
              };
            },
          }),
          update: (values: unknown) => {
            breakUpdateSpy(values);
            return {
              eq: (col: string, val: unknown) => {
                breakUpdateEqSpy(col, val);
                return {
                  is: (col2: string, val2: unknown) => {
                    breakUpdateIsSpy(col2, val2);
                    return Promise.resolve({ error: script.breakCloseError ?? null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "profiles") {
        return {
          update: (values: unknown) => {
            profileUpdateSpy(values);
            return {
              eq: (col: string, val: unknown) => {
                profileEqSpy(col, val);
                return {
                  neq: (col2: string, val2: unknown) => {
                    profileNeqSpy(col2, val2);
                    return {
                      select: () =>
                        Promise.resolve({ data: flipped, error: script.flipError ?? null }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {};
    },
  } as unknown as Admin;

  return {
    admin,
    ltSpy,
    shiftUpdateSpy,
    shiftUpdateEqSpy,
    shiftUpdateIsSpy,
    breakSelectEqSpy,
    breakSelectIsSpy,
    breakUpdateSpy,
    breakUpdateEqSpy,
    breakUpdateIsSpy,
    profileUpdateSpy,
    profileEqSpy,
    profileNeqSpy,
  };
}

describe("capOverlongShifts", () => {
  const NOW = Date.parse("2026-07-13T12:00:00.000Z");
  const startedAt = new Date(NOW - 20 * 60 * 60 * 1000).toISOString(); // 20h ago -> over the 10h cap
  const ceilingIso = new Date(Date.parse(startedAt) + MAX_SHIFT_MS).toISOString();
  const overCapRow = { id: "shift-9", user_id: "u9", started_at: startedAt };

  it("scans open shifts started before now - MAX_SHIFT_MS", async () => {
    const { admin, ltSpy } = capMockAdmin({ overCap: [] });
    await capOverlongShifts(admin, NOW);
    expect(ltSpy).toHaveBeenCalledTimes(1);
    const [col, iso] = ltSpy.mock.calls[0]!;
    expect(col).toBe("started_at");
    expect(Date.parse(iso as string)).toBe(NOW - MAX_SHIFT_MS);
  });

  it("does nothing (no writes) when no shift is over the cap", async () => {
    const { admin, shiftUpdateSpy, breakUpdateSpy, profileUpdateSpy } = capMockAdmin({
      overCap: [],
    });
    const n = await capOverlongShifts(admin, NOW);
    expect(n).toBe(0);
    expect(shiftUpdateSpy).not.toHaveBeenCalled();
    expect(breakUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
  });

  it("flips the agent OFFLINE FIRST, scoped .eq(id) and EXCLUDING a live call (.neq ON_CALL)", async () => {
    const { admin, profileUpdateSpy, profileEqSpy, profileNeqSpy } = capMockAdmin({
      overCap: [overCapRow],
    });

    await capOverlongShifts(admin, NOW);

    expect(profileUpdateSpy).toHaveBeenCalledWith({ status: "OFFLINE" });
    expect(profileEqSpy).toHaveBeenCalledWith("id", "u9");
    // Never end a live call: the flip must exclude ON_CALL.
    expect(profileNeqSpy).toHaveBeenCalledWith("status", "ON_CALL");
  });

  it("closes an over-cap shift at the CEILING (started + MAX_SHIFT_MS), reason 'capped'", async () => {
    // ceiling = started + 10h, NOT now — the whole point of the cap.
    const { admin, shiftUpdateSpy, shiftUpdateEqSpy, shiftUpdateIsSpy } = capMockAdmin({
      overCap: [overCapRow],
    });

    const n = await capOverlongShifts(admin, NOW);

    expect(n).toBe(1);
    expect(shiftUpdateSpy).toHaveBeenCalledWith({
      ended_at: ceilingIso,
      ended_reason: "capped",
    });
    // Scoped to this shift + guarded open-only (first-writer-wins).
    expect(shiftUpdateEqSpy).toHaveBeenCalledWith("id", "shift-9");
    expect(shiftUpdateIsSpy).toHaveBeenCalledWith("ended_at", null);
  });

  it("SKIPS an ON_CALL agent ENTIRELY: shift NOT closed, returns 0 (finding 1)", async () => {
    // The flip matches 0 rows (she is ON_CALL) -> the close must be gated off so
    // her shift stays OPEN and the next sweep re-caps her once the call ends.
    const { admin, shiftUpdateSpy, breakUpdateSpy, breakSelectEqSpy } = capMockAdmin({
      overCap: [overCapRow],
      flipped: [],
    });

    const n = await capOverlongShifts(admin, NOW);

    expect(n).toBe(0);
    expect(shiftUpdateSpy).not.toHaveBeenCalled();
    expect(breakUpdateSpy).not.toHaveBeenCalled();
    expect(breakSelectEqSpy).not.toHaveBeenCalled();
  });

  it("leaves the shift OPEN (no close) when the OFFLINE flip errors", async () => {
    const { admin, shiftUpdateSpy } = capMockAdmin({
      overCap: [overCapRow],
      flipError: { code: "500", message: "boom" },
    });
    const n = await capOverlongShifts(admin, NOW);
    expect(n).toBe(0);
    expect(shiftUpdateSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("closes an open break at the ceiling, scoped .eq(id) + first-writer-wins .is(ended_at,null)", async () => {
    // A break started BEFORE the ceiling -> closed at the ceiling.
    const breakStart = new Date(Date.parse(startedAt) + 5 * 60 * 60 * 1000).toISOString();
    const {
      admin,
      breakSelectEqSpy,
      breakSelectIsSpy,
      breakUpdateSpy,
      breakUpdateEqSpy,
      breakUpdateIsSpy,
    } = capMockAdmin({
      overCap: [overCapRow],
      openBreak: { id: "break-3", started_at: breakStart },
    });

    await capOverlongShifts(admin, NOW);

    // The open break is looked up for this shift, open-only.
    expect(breakSelectEqSpy).toHaveBeenCalledWith("shift_id", "shift-9");
    expect(breakSelectIsSpy).toHaveBeenCalledWith("ended_at", null);
    // Closed at the ceiling, scoped to the break row + guarded open-only.
    expect(breakUpdateSpy).toHaveBeenCalledWith({ ended_at: ceilingIso });
    expect(breakUpdateEqSpy).toHaveBeenCalledWith("id", "break-3");
    expect(breakUpdateIsSpy).toHaveBeenCalledWith("ended_at", null);
  });

  it("clamps a break OPENED PAST the ceiling to its own start (no negative duration, finding 3)", async () => {
    // She took a break at hour 12 of a shift that ran 20h — its start is AFTER the
    // 10h ceiling, so closing at the ceiling would give ended_at < started_at.
    const breakStart = new Date(Date.parse(startedAt) + 12 * 60 * 60 * 1000).toISOString();
    const { admin, breakUpdateSpy } = capMockAdmin({
      overCap: [overCapRow],
      openBreak: { id: "break-late", started_at: breakStart },
    });

    await capOverlongShifts(admin, NOW);

    // Clamped to max(started_at, ceiling) = started_at, never earlier.
    expect(breakUpdateSpy).toHaveBeenCalledWith({ ended_at: breakStart });
  });

  it("returns 0 and does not throw on a scan read error", async () => {
    const { admin, shiftUpdateSpy, profileUpdateSpy } = capMockAdmin({
      scanError: { code: "500", message: "boom" },
    });
    const n = await capOverlongShifts(admin, NOW);
    expect(n).toBe(0);
    expect(shiftUpdateSpy).not.toHaveBeenCalled();
    expect(profileUpdateSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("logs (but does not throw) when a shift close errors", async () => {
    const { admin } = capMockAdmin({
      overCap: [overCapRow],
      shiftUpdateError: { code: "500", message: "boom" },
    });
    // The flip took, so the row still counts as capped even though the close errored.
    await expect(capOverlongShifts(admin, NOW)).resolves.toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
