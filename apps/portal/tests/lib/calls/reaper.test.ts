import { describe, it, expect } from "vitest";
import {
  reapCutoffs,
  REAP_IN_PROGRESS_AFTER_MS,
  REAP_RINGING_AFTER_MS,
} from "@/lib/calls/reaper";

describe("reapCutoffs", () => {
  const now = Date.parse("2026-06-06T12:00:00.000Z");

  it("in-progress cutoff is `now` minus the in-progress window", () => {
    const { inProgressBefore } = reapCutoffs(now);
    expect(inProgressBefore).toBe(
      new Date(now - REAP_IN_PROGRESS_AFTER_MS).toISOString(),
    );
  });

  it("ringing cutoff is `now` minus the ringing window", () => {
    const { ringingBefore } = reapCutoffs(now);
    expect(ringingBefore).toBe(
      new Date(now - REAP_RINGING_AFTER_MS).toISOString(),
    );
  });

  it("in-progress window is well beyond any real front-desk call (>= 30 min)", () => {
    expect(REAP_IN_PROGRESS_AFTER_MS).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it("ringing window is well beyond the 120s ring window", () => {
    expect(REAP_RINGING_AFTER_MS).toBeGreaterThan(120_000);
  });
});
