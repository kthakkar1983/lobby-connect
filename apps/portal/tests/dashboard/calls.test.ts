import { describe, it, expect } from "vitest";
import { countToday, avgPickupSeconds, sumTodayDurationSeconds } from "@/lib/dashboard/calls";

const NOW = new Date("2026-06-08T02:00:00Z"); // 9:00 PM America/Chicago on Jun 7

describe("countToday", () => {
  it("counts items whose ring_started_at is 'today' in their own timezone", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" }, // Jun 7 8pm CT -> today
      { ring_started_at: "2026-06-06T01:00:00Z", timeZone: "America/Chicago" }, // earlier -> no
      { ring_started_at: "2026-06-08T01:30:00Z", timeZone: "America/New_York" }, // Jun 7 9:30pm ET -> today
    ];
    expect(countToday(items, NOW)).toBe(2);
  });
  it("is 0 for empty", () => {
    expect(countToday([], NOW)).toBe(0);
  });
});

describe("avgPickupSeconds", () => {
  it("averages answered_at - ring_started_at over today's answered calls, rounded", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", answered_at: "2026-06-08T01:00:10Z", timeZone: "America/Chicago" }, // 10s
      { ring_started_at: "2026-06-08T01:05:00Z", answered_at: "2026-06-08T01:05:20Z", timeZone: "America/Chicago" }, // 20s
      { ring_started_at: "2026-06-08T01:06:00Z", answered_at: null, timeZone: "America/Chicago" }, // unanswered -> ignored
    ];
    expect(avgPickupSeconds(items, NOW)).toBe(15);
  });
  it("returns null when there are no answered calls today", () => {
    expect(avgPickupSeconds([], NOW)).toBeNull();
    expect(
      avgPickupSeconds(
        [{ ring_started_at: "2026-06-08T01:00:00Z", answered_at: null, timeZone: "America/Chicago" }],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("sumTodayDurationSeconds", () => {
  const NOW2 = new Date("2026-06-08T02:00:00Z");
  it("sums duration_seconds over today's calls, treating null as 0, ignoring non-today", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", duration_seconds: 120, timeZone: "America/Chicago" }, // today
      { ring_started_at: "2026-06-08T01:10:00Z", duration_seconds: null, timeZone: "America/Chicago" }, // today, null -> 0
      { ring_started_at: "2026-06-06T01:00:00Z", duration_seconds: 999, timeZone: "America/Chicago" }, // not today
    ];
    expect(sumTodayDurationSeconds(items, NOW2)).toBe(120);
  });
  it("is 0 for empty", () => {
    expect(sumTodayDurationSeconds([], NOW2)).toBe(0);
  });
});
