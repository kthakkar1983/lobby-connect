import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SHIFT_ABANDON_AFTER_MS, PRESENCE_STALE_AFTER_MS, MAX_SHIFT_MS } from "@lc/shared";

// Rows the sweep UPDATE ... .select() returns (the profiles it flipped OFFLINE).
let sweptRows: Array<{ id: string; last_seen_at: string | null }> = [];
// The open shift closeOpenShiftForUser finds for a swept agent (null = none).
let openShift: { id: string; started_at: string } | null = null;
// Open shifts the max-shift-cap scan (.is().lt()) returns (started > MAX_SHIFT_MS ago).
let overCapShifts: Array<{ id: string; user_id: string; started_at: string }> = [];
// Rows the cap's OFFLINE flip (.eq().neq().select()) returns — non-empty = she was
// flipped (not ON_CALL) so the shift close proceeds; [] = ON_CALL, skip the close.
let capFlipRows: Array<{ id: string }> = [{ id: "capped-user" }];
const profilesUpdateSpy = vi.fn();
const shiftCloseSpy = vi.fn();
// Captures (column, cutoffIso) passed to the sweep's `.lt(...)` staleness bound.
const ltSpy = vi.fn();
// Captures (column, cutoffIso) passed to the cap scan's `.lt("started_at", …)`.
const capLtSpy = vi.fn();
// Captures the cap OFFLINE-flip's `.eq(...)` — DISTINCT from the abandon sweep,
// which flips via `.lt().neq()`, never `.eq()`. This is what lets the test pin the
// cap's own flip instead of matching the abandon sweep's identical {status:OFFLINE}.
const capFlipEqSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "operators") {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (table === "health_signals") {
        return { upsert: () => Promise.resolve({ error: null }) };
      }
      if (table === "profiles") {
        return {
          update: (v: unknown) => {
            profilesUpdateSpy(v);
            return {
              // Abandon sweep: .update({OFFLINE}).lt(last_seen_at).neq(OFFLINE).select()
              lt: (col: string, val: string) => {
                ltSpy(col, val);
                return {
                  neq: () => ({
                    select: () => Promise.resolve({ data: sweptRows, error: null }),
                  }),
                };
              },
              // Max-shift cap OFFLINE flip: .update({OFFLINE}).eq(id).neq(ON_CALL).select("id")
              eq: (col: string, val: string) => {
                capFlipEqSpy(col, val);
                return {
                  neq: () => ({ select: () => Promise.resolve({ data: capFlipRows, error: null }) }),
                };
              },
            };
          },
        };
      }
      if (table === "shifts") {
        return {
          select: () => ({
            // closeOpenShiftForUser open-shift read: .eq().is().maybeSingle()
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({ data: openShift, error: null }),
              }),
            }),
            // capOverlongShifts scan: .is("ended_at",null).lt("started_at", iso) -> array
            is: () => ({
              lt: (col: string, val: string) => {
                capLtSpy(col, val);
                return Promise.resolve({ data: overCapShifts, error: null });
              },
            }),
          }),
          update: (v: unknown) => {
            shiftCloseSpy(v);
            return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      if (table === "shift_breaks") {
        return {
          // Cap open-break read: .select().eq().is().maybeSingle() (no open break here).
          select: () => ({
            eq: () => ({ is: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          }),
          update: () => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }),
        };
      }
      return {};
    },
  }),
}));

import { GET } from "@/app/api/cron/mark-stale-offline/route";

function req(auth?: string) {
  return new Request("http://localhost:3000/api/cron/mark-stale-offline", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  profilesUpdateSpy.mockClear();
  shiftCloseSpy.mockClear();
  ltSpy.mockClear();
  capLtSpy.mockClear();
  capFlipEqSpy.mockClear();
  sweptRows = [];
  openShift = null;
  overCapShifts = [];
  capFlipRows = [{ id: "capped-user" }];
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/mark-stale-offline", () => {
  it("401 when CRON_SECRET is set but the header is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(profilesUpdateSpy).not.toHaveBeenCalled();
  });

  it("sweeps stale rows to OFFLINE when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(profilesUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OFFLINE" }),
    );
  });

  it("401 when CRON_SECRET is unset (fails closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(profilesUpdateSpy).not.toHaveBeenCalled();
  });

  it("closes each swept agent's open shift at its OWN last_seen_at (spec D9)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    sweptRows = [{ id: "u1", last_seen_at: "2026-07-12T04:00:00.000Z" }];
    openShift = { id: "shift-1", started_at: "2026-07-12T03:30:00.000Z" };
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    // ended_at is the swept row's last_seen_at (not "now"); a 30-min shift is `lapsed`.
    expect(shiftCloseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ended_at: "2026-07-12T04:00:00.000Z",
        ended_reason: "lapsed",
      }),
    );
  });

  it("does not touch shifts when nothing was swept", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    sweptRows = [];
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(shiftCloseSpy).not.toHaveBeenCalled();
  });

  it("also runs the max-shift cap: scans open shifts started > MAX_SHIFT_MS ago", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const before = Date.now();
    const res = await GET(req("Bearer s3cret"));
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(capLtSpy).toHaveBeenCalledWith("started_at", expect.any(String));
    const cutoffMs = Date.parse(String(capLtSpy.mock.calls[0]?.[1]));
    expect(after - cutoffMs).toBeGreaterThanOrEqual(MAX_SHIFT_MS);
    expect(before - cutoffMs).toBeLessThanOrEqual(MAX_SHIFT_MS);
  });

  it("caps an over-cap open shift at the ceiling and flips the agent OFFLINE", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    // A forgotten shift on an awake machine: fresh heartbeat (never swept), but
    // started 20h ago (> the 10h cap). sweptRows stays empty so ONLY the cap fires.
    const startedAt = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const ceilingIso = new Date(Date.parse(startedAt) + MAX_SHIFT_MS).toISOString();
    overCapShifts = [{ id: "shift-9", user_id: "u9", started_at: startedAt }];

    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    // Closed at the CEILING (started + MAX_SHIFT_MS), reason 'capped' — never "now".
    expect(shiftCloseSpy).toHaveBeenCalledWith({
      ended_at: ceilingIso,
      ended_reason: "capped",
    });
    // Forced OFFLINE by the CAP specifically — pinned via .eq("id", user_id), which
    // ONLY the cap flip uses. (The abandon sweep also writes {status:"OFFLINE"} on
    // every run via .lt().neq(), so asserting the payload alone would be vacuous.)
    expect(capFlipEqSpy).toHaveBeenCalledWith("id", "u9");
  });

  it("does not cap anything when no shift is over the cap", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    overCapShifts = [];
    sweptRows = [];
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(shiftCloseSpy).not.toHaveBeenCalled();
    expect(capFlipEqSpy).not.toHaveBeenCalled();
  });

  it("runs the abandon sweep BEFORE the max-shift cap (invariant 6)", async () => {
    // Ordering matters: a shift that is both stale-past-12h AND over-cap must close
    // at its accurate last_seen_at (abandon), not the ceiling (cap). The .is(ended_at,
    // null) guards keep it corruption-free either way, but abandon-first is the
    // labeling-accuracy contract. Pin it via invocation order: the abandon staleness
    // `.lt(last_seen_at)` must fire before the cap scan `.lt(started_at)`.
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(ltSpy).toHaveBeenCalled();
    expect(capLtSpy).toHaveBeenCalled();
    const abandonOrder = ltSpy.mock.invocationCallOrder[0]!;
    const capOrder = capLtSpy.mock.invocationCallOrder[0]!;
    expect(abandonOrder).toBeLessThan(capOrder);
  });

  it("cuts at the 12h abandon horizon, NOT the 90s reachability staleness (task_71d65b0a)", async () => {
    // A throttled-but-working agent is stale within minutes; only an agent
    // stale past the abandon horizon (session provably dead) may be swept
    // OFFLINE + have her shift ended. So the sweep's last_seen_at bound must be
    // ~SHIFT_ABANDON_AFTER_MS ago, never ~PRESENCE_STALE_AFTER_MS.
    vi.stubEnv("CRON_SECRET", "s3cret");
    const before = Date.now();
    const res = await GET(req("Bearer s3cret"));
    const after = Date.now();
    expect(res.status).toBe(200);

    expect(ltSpy).toHaveBeenCalledWith("last_seen_at", expect.any(String));
    const cutoffMs = Date.parse(String(ltSpy.mock.calls[0]?.[1]));
    // cutoff = now - SHIFT_ABANDON_AFTER_MS, with now in [before, after].
    expect(after - cutoffMs).toBeGreaterThanOrEqual(SHIFT_ABANDON_AFTER_MS);
    expect(before - cutoffMs).toBeLessThanOrEqual(SHIFT_ABANDON_AFTER_MS);
    // And emphatically not the short reachability window.
    expect(after - cutoffMs).toBeGreaterThan(PRESENCE_STALE_AFTER_MS);
  });
});
