import { describe, it, expect } from "vitest";
import {
  RING_WINDOW_SECONDS,
  RING_WINDOW_MS,
  PRESENCE_STALE_AFTER_MS,
  REAP_RINGING_AFTER_MS,
  REAP_IN_PROGRESS_AFTER_MS,
  CRON_SWEEP_INTERVAL_MS,
} from "../src/protocol";

describe("protocol timing invariants", () => {
  it("reaper ringing cutoff outlasts the ring window", () => {
    expect(REAP_RINGING_AFTER_MS).toBeGreaterThan(RING_WINDOW_MS);
  });

  it("pins the documented values (no accidental drift)", () => {
    expect(RING_WINDOW_SECONDS).toBe(120);
    expect(RING_WINDOW_MS).toBe(120_000);
    expect(PRESENCE_STALE_AFTER_MS).toBe(90_000);
    expect(REAP_RINGING_AFTER_MS).toBe(600_000);
    expect(REAP_IN_PROGRESS_AFTER_MS).toBe(1_800_000);
    expect(CRON_SWEEP_INTERVAL_MS).toBe(86_400_000);
  });
});
