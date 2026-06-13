import { describe, it, expect } from "vitest";
import { startOfTodayUtc } from "@/lib/calls/today-window";

describe("startOfTodayUtc", () => {
  it("UTC: midnight of the same calendar day", () => {
    expect(startOfTodayUtc("UTC", new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12T00:00:00.000Z");
  });
  it("America/Chicago (CDT, UTC-5 in June): local midnight is 05:00Z", () => {
    expect(startOfTodayUtc("America/Chicago", new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12T05:00:00.000Z");
  });
  it("America/New_York (EDT, UTC-4 in June): local midnight is 04:00Z", () => {
    expect(startOfTodayUtc("America/New_York", new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12T04:00:00.000Z");
  });
  it("just-after-local-midnight still maps to the same local day's midnight", () => {
    expect(startOfTodayUtc("America/Chicago", new Date("2026-06-12T05:30:00Z"))).toBe("2026-06-12T05:00:00.000Z");
  });
});
