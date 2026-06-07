import { describe, it, expect } from "vitest";
import {
  reapCutoffs,
  inProgressIsStale,
  reapDurationSeconds,
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

describe("inProgressIsStale", () => {
  const now = Date.parse("2026-06-06T12:00:00.000Z");
  const old = new Date(now - REAP_IN_PROGRESS_AFTER_MS - 60_000).toISOString();
  const recent = new Date(now - 60_000).toISOString();

  it("is stale when answered_at is older than the in-progress window", () => {
    expect(inProgressIsStale({ created_at: old, answered_at: old }, now)).toBe(true);
  });

  it("is NOT stale when recently answered, even if created long ago", () => {
    // A legitimately long call answered a minute ago must not be force-closed.
    expect(inProgressIsStale({ created_at: old, answered_at: recent }, now)).toBe(false);
  });

  it("falls back to created_at when answered_at is NULL (no blind spot)", () => {
    expect(inProgressIsStale({ created_at: old, answered_at: null }, now)).toBe(true);
    expect(inProgressIsStale({ created_at: recent, answered_at: null }, now)).toBe(false);
  });
});

describe("reapDurationSeconds", () => {
  const ended = Date.parse("2026-06-06T12:00:00.000Z");

  it("returns null when the call was never answered", () => {
    expect(reapDurationSeconds(null, ended)).toBeNull();
  });

  it("computes whole seconds from answered_at to ended", () => {
    const answered = new Date(ended - 90_000).toISOString();
    expect(reapDurationSeconds(answered, ended)).toBe(90);
  });

  it("clamps a negative span (clock skew) to 0", () => {
    const answered = new Date(ended + 5_000).toISOString();
    expect(reapDurationSeconds(answered, ended)).toBe(0);
  });
});
