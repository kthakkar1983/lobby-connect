import { describe, it, expect } from "vitest";

import {
  isStale,
  effectivePresence,
  STALE_AFTER_MS,
  DEFAULT_LOGIN_STATUS,
  isLiveStatus,
  type PresenceStatus,
} from "@/lib/voice/presence";

describe("isStale", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");

  it("treats a null last_seen as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("is not stale within the window", () => {
    const recent = new Date(now - (STALE_AFTER_MS - 1000)).toISOString();
    expect(isStale(recent, now)).toBe(false);
  });

  it("is stale past the window", () => {
    const old = new Date(now - (STALE_AFTER_MS + 1000)).toISOString();
    expect(isStale(old, now)).toBe(true);
  });
});

describe("effectivePresence", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");
  const fresh = new Date(now - (STALE_AFTER_MS - 1000)).toISOString();
  const stale = new Date(now - (STALE_AFTER_MS + 1000)).toISOString();

  it("returns the stored status when heartbeat is fresh", () => {
    expect(effectivePresence("AVAILABLE", fresh, now)).toBe("AVAILABLE");
    expect(effectivePresence("ON_CALL", fresh, now)).toBe("ON_CALL");
    expect(effectivePresence("AWAY", fresh, now)).toBe("AWAY");
  });

  it("returns OFFLINE when heartbeat is stale, regardless of stored status", () => {
    expect(effectivePresence("AVAILABLE", stale, now)).toBe("OFFLINE");
    expect(effectivePresence("ON_CALL", stale, now)).toBe("OFFLINE");
  });

  it("returns OFFLINE when last_seen_at is null", () => {
    expect(effectivePresence("AVAILABLE", null, now)).toBe("OFFLINE");
  });
});

describe("constants + guards", () => {
  it("defaults a fresh login to AVAILABLE", () => {
    expect(DEFAULT_LOGIN_STATUS).toBe<PresenceStatus>("AVAILABLE");
  });

  it("isLiveStatus accepts agent-settable statuses only", () => {
    expect(isLiveStatus("AVAILABLE")).toBe(true);
    expect(isLiveStatus("AWAY")).toBe(true);
    expect(isLiveStatus("ON_CALL")).toBe(true);
    expect(isLiveStatus("OFFLINE")).toBe(false);
    expect(isLiveStatus("bogus")).toBe(false);
  });
});
