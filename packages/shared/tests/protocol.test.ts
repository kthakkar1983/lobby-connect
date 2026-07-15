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
  SESSION_MAX_MS,
  SHIFT_CAP_EPSILON_MS,
  SHIFT_ABANDON_AFTER_MS,
  MAX_SHIFT_MS,
  OUTBOUND_RING_WINDOW_SECONDS,
  OUTBOUND_RING_WINDOW_MS,
  KIOSK_STALE_AFTER_MS,
  RECONNECT_WINDOW_MS,
} from "../src/protocol";

const VIDEO_TOKEN_TTL_MS = 3_600_000; // video/token mints a 3600s join token, no renewal

describe("protocol timing invariants", () => {
  it("reaper ringing cutoff outlasts the ring window", () => {
    expect(REAP_RINGING_AFTER_MS).toBeGreaterThan(RING_WINDOW_MS);
  });

  it("incoming-video fallback poll is a slow safety net (much slower than the old 3s poll)", () => {
    expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBe(60_000);
    expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("max-call-duration cap ends a connected call BEFORE the video join token TTL (the cost backstop)", () => {
    // If the cap exceeded the 3600s token, a silent token-expiry disconnect — not
    // our cap — would be what ends an abandoned call, defeating the purpose.
    expect(MAX_CALL_DURATION_MS).toBeLessThan(VIDEO_TOKEN_TTL_MS);
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

it("session cap is 12h and epsilon is a sane sliver under it", () => {
  expect(SESSION_MAX_MS).toBe(12 * 60 * 60 * 1000);
  expect(SHIFT_CAP_EPSILON_MS).toBeGreaterThan(0);
  expect(SHIFT_CAP_EPSILON_MS).toBeLessThan(SESSION_MAX_MS / 10);
});

describe("shift-abandon horizon (the cron's shift-close / OFFLINE-flip cutoff)", () => {
  it("equals the 12h session cap (fires only after the session is provably dead)", () => {
    // last_beat >= login and the session dies at login + SESSION_MAX, so
    // last_beat + SESSION_MAX >= session death: the sweep can never catch a
    // still-working agent. SESSION_MAX is the minimum horizon with that guarantee.
    expect(SHIFT_ABANDON_AFTER_MS).toBe(SESSION_MAX_MS);
  });

  it("is never shorter than the read-time reachability staleness window", () => {
    // The abandon horizon (genuinely gone) must outlast the 90s reachability
    // staleness (a throttled-but-working tab). Same guard runs at module load.
    expect(SHIFT_ABANDON_AFTER_MS).toBeGreaterThanOrEqual(PRESENCE_STALE_AFTER_MS);
  });
});

describe("app-level max-shift cap (the free-tier session-cap stand-in)", () => {
  it("is 10h", () => {
    expect(MAX_SHIFT_MS).toBe(10 * 60 * 60 * 1000);
  });

  it("is a sane multi-hour ceiling (well past the reachability staleness)", () => {
    // The PRIMARY max-shift ceiling (fires before the deferred 12h session cap).
    // It must outlast the 90s read-time reachability staleness. Same guard runs at
    // module load.
    expect(MAX_SHIFT_MS).toBeGreaterThan(PRESENCE_STALE_AFTER_MS);
  });
});

describe("outbound + liveness protocol constants", () => {
  it("outbound ring window is 30s and shorter than the inbound window", () => {
    expect(OUTBOUND_RING_WINDOW_SECONDS).toBe(30);
    expect(OUTBOUND_RING_WINDOW_MS).toBe(30_000);
    expect(OUTBOUND_RING_WINDOW_MS).toBeLessThan(RING_WINDOW_MS);
  });
  it("outbound ring window is under the reaper ringing backstop", () => {
    expect(OUTBOUND_RING_WINDOW_MS).toBeLessThan(REAP_RINGING_AFTER_MS);
  });
  it("kiosk staleness is 90s (survives one missed 30s heartbeat)", () => {
    expect(KIOSK_STALE_AFTER_MS).toBe(90_000);
  });
  it("reconnect window is 10s", () => {
    expect(RECONNECT_WINDOW_MS).toBe(10_000);
  });
});
