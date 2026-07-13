import { describe, it, expect } from "vitest";
import { NextResponse } from "next/server";
import { requireOnDuty } from "@/lib/shifts/gate";

type Admin = Parameters<typeof requireOnDuty>[0];

type ProfileRow = { status: string; last_seen_at: string | null } | null;
type QueryError = { code?: string; message?: string } | null;

/** Minimal fake admin client for `profiles.select(...).eq(...).maybeSingle()`. */
function mockAdmin(result: { data: ProfileRow; error: QueryError }) {
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as Admin;
  return admin;
}

const USER_ID = "user-1";
const NOW = Date.parse("2026-07-12T10:00:00.000Z");

describe("requireOnDuty", () => {
  it("passes when AVAILABLE", async () => {
    const admin = mockAdmin({
      data: { status: "AVAILABLE", last_seen_at: new Date(Date.now() - 10_000).toISOString() },
      error: null,
    });
    expect(await requireOnDuty(admin, USER_ID)).toBeNull();
  });

  it("passes when AVAILABLE but the heartbeat is STALE — a throttled portal tab is normal working state, not off-duty (regression: the pushed-video answer 403)", async () => {
    const admin = mockAdmin({
      data: { status: "AVAILABLE", last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() },
      error: null,
    });
    expect(await requireOnDuty(admin, USER_ID)).toBeNull();
  });

  it("passes when ON_CALL (even with a stale heartbeat)", async () => {
    const admin = mockAdmin({
      data: { status: "ON_CALL", last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() },
      error: null,
    });
    expect(await requireOnDuty(admin, USER_ID)).toBeNull();
  });

  it("403s when OFFLINE", async () => {
    const admin = mockAdmin({
      data: { status: "OFFLINE", last_seen_at: new Date(NOW).toISOString() },
      error: null,
    });
    const result = await requireOnDuty(admin, USER_ID);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(403);
  });

  it("403s when BREAK", async () => {
    const admin = mockAdmin({
      data: { status: "BREAK", last_seen_at: new Date(NOW).toISOString() },
      error: null,
    });
    const result = await requireOnDuty(admin, USER_ID);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(403);
  });

  it("403s (fail closed) on a read error", async () => {
    const admin = mockAdmin({
      data: null,
      error: { code: "500", message: "boom" },
    });
    const result = await requireOnDuty(admin, USER_ID);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(403);
  });

  it("403s (fail closed) on a missing profile row with no error", async () => {
    const admin = mockAdmin({ data: null, error: null });
    const result = await requireOnDuty(admin, USER_ID);
    expect(result).toBeInstanceOf(NextResponse);
    expect(result?.status).toBe(403);
  });
});
