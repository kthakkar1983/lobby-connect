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
  it("passes when AVAILABLE + fresh", async () => {
    // requireOnDuty stamps freshness against the real Date.now(), so anchor the
    // "fresh" heartbeat to the real clock (a fixed past ISO would read as stale).
    const admin = mockAdmin({
      data: { status: "AVAILABLE", last_seen_at: new Date(Date.now() - 10_000).toISOString() },
      error: null,
    });
    const result = await requireOnDuty(admin, USER_ID);
    expect(result).toBeNull();
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
});
