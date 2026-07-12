import { describe, it, expect, vi, beforeEach } from "vitest";
import { SESSION_MAX_MS } from "@lc/shared";
import { openShift, closeOpenShiftForUser, openBreak, closeOpenBreak } from "@/lib/shifts/store";

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
    await openShift(admin, USER_ID, OPERATOR_ID);
    expect(insertSpy).toHaveBeenCalledWith("shifts", {
      user_id: USER_ID,
      operator_id: OPERATOR_ID,
    });
  });

  it("swallows a 23505 unique violation (already open)", async () => {
    const { admin } = mockAdmin({
      insert: { shifts: { error: { code: "23505" } } },
    });
    await expect(openShift(admin, USER_ID, OPERATOR_ID)).resolves.toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs (but does not throw) on a non-23505 insert error", async () => {
    const { admin } = mockAdmin({
      insert: { shifts: { error: { code: "500", message: "boom" } } },
    });
    await expect(openShift(admin, USER_ID, OPERATOR_ID)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
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
