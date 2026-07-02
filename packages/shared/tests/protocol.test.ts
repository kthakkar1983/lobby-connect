import { describe, it, expect } from "vitest";
import {
  RING_WINDOW_SECONDS,
  RING_WINDOW_MS,
  PRESENCE_STALE_AFTER_MS,
  REAP_RINGING_AFTER_MS,
  REAP_IN_PROGRESS_AFTER_MS,
  CRON_SWEEP_INTERVAL_MS,
  INCOMING_VIDEO_FALLBACK_POLL_MS,
  MAX_CALL_DURATION_MS,
} from "../src/protocol";

const AGORA_TOKEN_TTL_MS = 3_600_000; // agora/token mints a 3600s token, no renewal

describe("protocol timing invariants", () => {
  it("reaper ringing cutoff outlasts the ring window", () => {
    expect(REAP_RINGING_AFTER_MS).toBeGreaterThan(RING_WINDOW_MS);
  });

  it("incoming-video fallback poll is a slow safety net (much slower than the old 3s poll)", () => {
    expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBe(60_000);
    expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("max-call-duration cap ends a connected call BEFORE the Agora token TTL (the cost backstop)", () => {
    // If the cap exceeded the 3600s token, a silent token-expiry disconnect — not
    // our cap — would be what ends an abandoned call, defeating the purpose.
    expect(MAX_CALL_DURATION_MS).toBeLessThan(AGORA_TOKEN_TTL_MS);
    expect(MAX_CALL_DURATION_MS).toBeGreaterThan(RING_WINDOW_MS); // never cut a still-ringing call short
  });

  it("pins the documented values (no accidental drift)", () => {
    expect(RING_WINDOW_SECONDS).toBe(120);
    expect(RING_WINDOW_MS).toBe(120_000);
    expect(PRESENCE_STALE_AFTER_MS).toBe(90_000);
    expect(REAP_RINGING_AFTER_MS).toBe(600_000);
    expect(REAP_IN_PROGRESS_AFTER_MS).toBe(1_800_000);
    expect(CRON_SWEEP_INTERVAL_MS).toBe(86_400_000);
    expect(MAX_CALL_DURATION_MS).toBe(1_800_000);
  });
});
