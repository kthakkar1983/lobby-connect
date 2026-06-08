import { describe, it, expect } from "vitest";
import {
  isToday,
  countTodayCalls,
  isOpenIncident,
  countOpenIncidents,
  dayGroupLabel,
  latestCallTime,
} from "@/lib/owner/summary";

const NOW = new Date("2026-06-02T16:00:00Z"); // 12:00 PM in New York (UTC-4)

describe("isToday (timezone-aware)", () => {
  it("is true for an instant on the same local calendar day", () => {
    // 2026-06-02 09:00 local NY
    expect(isToday("2026-06-02T13:00:00Z", "America/New_York", NOW)).toBe(true);
  });

  it("is false for yesterday in that timezone", () => {
    // 2026-06-01 23:00 local NY
    expect(isToday("2026-06-02T03:00:00Z", "America/New_York", NOW)).toBe(false);
  });

  it("respects the property timezone, not the server's", () => {
    // 2026-06-02 03:00Z is still 2026-06-01 20:00 in LA → not "today" in LA
    expect(isToday("2026-06-02T03:00:00Z", "America/Los_Angeles", NOW)).toBe(false);
  });
});

describe("countTodayCalls", () => {
  it("counts only calls whose local day equals today", () => {
    const calls = [
      { ring_started_at: "2026-06-02T13:00:00Z" }, // today NY
      { ring_started_at: "2026-06-02T14:30:00Z" }, // today NY
      { ring_started_at: "2026-06-02T03:00:00Z" }, // yesterday NY
    ];
    expect(countTodayCalls(calls, "America/New_York", NOW)).toBe(2);
  });
});

describe("incident counting", () => {
  it("treats anything not RESOLVED as open", () => {
    expect(isOpenIncident("OPEN")).toBe(true);
    expect(isOpenIncident("RESOLVED")).toBe(false);
    expect(
      countOpenIncidents([{ status: "OPEN" }, { status: "RESOLVED" }, { status: "OPEN" }]),
    ).toBe(2);
  });
});

describe("dayGroupLabel", () => {
  const now = new Date("2026-06-07T18:00:00Z"); // 1:00 PM America/Chicago
  it("Today / Yesterday / date", () => {
    expect(dayGroupLabel("2026-06-07T17:00:00Z", "America/Chicago", now)).toBe("Today");
    expect(dayGroupLabel("2026-06-06T17:00:00Z", "America/Chicago", now)).toBe("Yesterday");
    expect(dayGroupLabel("2026-06-01T17:00:00Z", "America/Chicago", now)).toMatch(/Jun 1/);
  });
});

describe("latestCallTime", () => {
  it("returns the max ring_started_at formatted (time only), or null", () => {
    expect(latestCallTime([], "America/Chicago")).toBeNull();
    const out = latestCallTime(
      [{ ring_started_at: "2026-06-07T02:00:00Z" }, { ring_started_at: "2026-06-07T02:42:00Z" }],
      "America/Chicago",
    );
    expect(out).toMatch(/9:42\s?PM/);
  });
});
