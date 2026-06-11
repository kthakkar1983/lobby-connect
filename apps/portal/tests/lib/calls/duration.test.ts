import { describe, it, expect } from "vitest";
import { computeDurationSeconds } from "@/lib/calls/duration";

describe("computeDurationSeconds", () => {
  it("rounds whole seconds from answeredAt to endedAtMs", () => {
    const answered = "2026-06-11T00:00:00.000Z";
    expect(computeDurationSeconds(answered, Date.parse(answered) + 90_400)).toBe(90);
  });
  it("returns null when answeredAt is null", () => {
    expect(computeDurationSeconds(null, Date.parse("2026-06-11T00:00:00.000Z"))).toBeNull();
  });
  it("clamps negative to 0", () => {
    const answered = "2026-06-11T00:00:10.000Z";
    expect(computeDurationSeconds(answered, Date.parse(answered) - 5000)).toBe(0);
  });
});
