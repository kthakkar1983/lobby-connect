import { describe, it, expect } from "vitest";
import { zoneTime, handAngles } from "@/lib/clocks/zone-time";

// Every instant below was computed against the real Intl/ICU tables before being
// written down, not reasoned about. The DST pair in particular is the genuinely
// ambiguous repeated hour on 2026-11-01, where 01:30 happens twice.

describe("zoneTime", () => {
  it("converts an instant into wall-clock parts for a zone", () => {
    // 2026-07-19T09:30:00Z -> 15:00 IST (UTC+5:30)
    expect(zoneTime(new Date("2026-07-19T09:30:00Z"), "Asia/Kolkata")).toEqual({
      hours: 15,
      minutes: 0,
      isNight: false,
    });
  });

  it("marks night outside 06:00-17:59 local", () => {
    // 2026-07-19T06:14:00Z -> 02:14 America/New_York (EDT, UTC-4)
    expect(zoneTime(new Date("2026-07-19T06:14:00Z"), "America/New_York")).toEqual({
      hours: 2,
      minutes: 14,
      isNight: true,
    });
  });

  it("treats 06:00 as day and 18:00 as night at the boundaries", () => {
    const night = (iso: string) => zoneTime(new Date(iso), "America/New_York").isNight;
    // Both sides of both boundaries: isNight has exactly two comparisons to get
    // wrong, and only the inner minute catches an off-by-one in either.
    expect(night("2026-07-19T09:59:00Z")).toBe(true); // 05:59
    expect(night("2026-07-19T10:00:00Z")).toBe(false); // 06:00
    expect(night("2026-07-19T21:59:00Z")).toBe(false); // 17:59
    expect(night("2026-07-19T22:00:00Z")).toBe(true); // 18:00
  });

  it("uses a 24-hour cycle, so local midnight is hour 0 and never 24", () => {
    // 2026-07-19T04:00:00Z -> 00:00 America/New_York
    expect(zoneTime(new Date("2026-07-19T04:00:00Z"), "America/New_York").hours).toBe(0);
  });

  it("reads the zone's own wall clock, not a UTC-derived hour", () => {
    // 2026-07-19T06:14:00Z is still 2026-07-18 in Los Angeles (23:14 PDT).
    // Anything deriving the hour from the UTC date lands on the wrong day here.
    expect(zoneTime(new Date("2026-07-19T06:14:00Z"), "America/Los_Angeles")).toEqual({
      hours: 23,
      minutes: 14,
      isNight: true,
    });
  });

  it("follows US daylight saving across the autumn transition", () => {
    // DST ends 2026-11-01 at 02:00 EDT. These two instants are one UTC hour
    // apart yet both read 01:30 locally -- the first EDT, the second EST.
    const edt = zoneTime(new Date("2026-11-01T05:30:00Z"), "America/New_York");
    const est = zoneTime(new Date("2026-11-01T06:30:00Z"), "America/New_York");
    expect(edt).toEqual({ hours: 1, minutes: 30, isNight: true });
    expect(est).toEqual({ hours: 1, minutes: 30, isNight: true });
  });

  it("keeps India fixed at UTC+5:30 across that same transition", () => {
    expect(zoneTime(new Date("2026-11-01T05:30:00Z"), "Asia/Kolkata").hours).toBe(11);
    expect(zoneTime(new Date("2026-06-01T05:30:00Z"), "Asia/Kolkata").hours).toBe(11);
  });

  it("returns the same answer for a repeated zone, so caching a formatter is safe", () => {
    const at = new Date("2026-07-19T09:30:00Z");
    expect(zoneTime(at, "Asia/Kolkata")).toEqual(zoneTime(at, "Asia/Kolkata"));
    // A cache keyed wrongly would leak the previous zone's formatter into this.
    expect(zoneTime(at, "America/Chicago").hours).toBe(4);
    expect(zoneTime(at, "Asia/Kolkata").hours).toBe(15);
  });
});

describe("handAngles", () => {
  it("puts both hands at twelve at midnight", () => {
    expect(handAngles(0, 0)).toEqual({ hour: 0, minute: 0 });
  });

  it("advances the minute hand six degrees per minute", () => {
    expect(handAngles(0, 15).minute).toBe(90);
    expect(handAngles(0, 45).minute).toBe(270);
  });

  it("creeps the hour hand between hours", () => {
    expect(handAngles(3, 0).hour).toBe(90);
    expect(handAngles(3, 30).hour).toBe(105);
  });

  it("wraps the hour hand at noon so 12-hour and 24-hour agree", () => {
    expect(handAngles(12, 0).hour).toBe(0); // the exact wrap point
    expect(handAngles(15, 0).hour).toBe(90);
  });

  it("stays under a full turn at the end of the day", () => {
    // 23:59 is the largest input a 24-hour clock can hand us; neither hand may
    // overflow past 360 and spin the face backwards.
    expect(handAngles(23, 59)).toEqual({ hour: 359.5, minute: 354 });
  });
});
