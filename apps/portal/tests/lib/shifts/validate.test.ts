import { describe, it, expect } from "vitest";
import { validateShiftTimes, SHIFT_CLOCK_SKEW_MS } from "@/lib/shifts/validate";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("validateShiftTimes", () => {
  it("accepts a closed shift with end strictly after start, both in the past", () => {
    expect(
      validateShiftTimes(iso(NOW - 3600_000), iso(NOW - 1800_000), NOW),
    ).toBeNull();
  });

  it("accepts an open shift (ended_at null) when start is valid and not in the future", () => {
    expect(validateShiftTimes(iso(NOW - 3600_000), null, NOW)).toBeNull();
  });

  it("rejects an unparseable start time", () => {
    expect(validateShiftTimes("not-a-date", null, NOW)).toBe(
      "Start time is invalid.",
    );
  });

  it("rejects an unparseable end time", () => {
    expect(
      validateShiftTimes(iso(NOW - 3600_000), "not-a-date", NOW),
    ).toBe("End time is invalid.");
  });

  it("rejects end === start (zero-length shift)", () => {
    expect(validateShiftTimes(iso(NOW - 1000), iso(NOW - 1000), NOW)).toBe(
      "End time must be after start time.",
    );
  });

  it("rejects end before start", () => {
    expect(validateShiftTimes(iso(NOW - 1000), iso(NOW - 5000), NOW)).toBe(
      "End time must be after start time.",
    );
  });

  it("rejects a start time in the future beyond the clock-skew allowance", () => {
    expect(
      validateShiftTimes(iso(NOW + SHIFT_CLOCK_SKEW_MS + 1000), null, NOW),
    ).toBe("Start time can't be in the future.");
  });

  it("accepts a start time exactly at the clock-skew boundary", () => {
    expect(
      validateShiftTimes(iso(NOW + SHIFT_CLOCK_SKEW_MS), null, NOW),
    ).toBeNull();
  });

  it("rejects an end time in the future beyond the clock-skew allowance", () => {
    expect(
      validateShiftTimes(
        iso(NOW - 3600_000),
        iso(NOW + SHIFT_CLOCK_SKEW_MS + 1000),
        NOW,
      ),
    ).toBe("End time can't be in the future.");
  });

  it("accepts an end time exactly at the clock-skew boundary", () => {
    expect(
      validateShiftTimes(
        iso(NOW - 3600_000),
        iso(NOW + SHIFT_CLOCK_SKEW_MS),
        NOW,
      ),
    ).toBeNull();
  });

  it("defaults `now` to Date.now() when omitted", () => {
    const start = new Date(Date.now() - 3600_000).toISOString();
    expect(validateShiftTimes(start, null)).toBeNull();
  });
});
