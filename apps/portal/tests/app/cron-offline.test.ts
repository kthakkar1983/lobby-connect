import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Rows the sweep UPDATE ... .select() returns (the profiles it flipped OFFLINE).
let sweptRows: Array<{ id: string; last_seen_at: string | null }> = [];
// The open shift closeOpenShiftForUser finds for a swept agent (null = none).
let openShift: { id: string; started_at: string } | null = null;
const profilesUpdateSpy = vi.fn();
const shiftCloseSpy = vi.fn();

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
              lt: () => ({
                neq: () => ({
                  select: () => Promise.resolve({ data: sweptRows, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === "shifts") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => Promise.resolve({ data: openShift, error: null }),
              }),
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
  sweptRows = [];
  openShift = null;
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
});
