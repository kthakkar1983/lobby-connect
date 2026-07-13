import { describe, it, expect } from "vitest";

import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";
import {
  isStale,
  effectivePresence,
  isReachableForDial,
  roleHasPresence,
  isLiveStatus,
} from "@/lib/voice/presence";
import { isVideoSilencedStatus } from "@/lib/push/targets";

describe("isStale", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");

  it("treats a null last_seen as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("is not stale within the window", () => {
    const recent = new Date(now - (PRESENCE_STALE_AFTER_MS - 1000)).toISOString();
    expect(isStale(recent, now)).toBe(false);
  });

  it("is stale past the window", () => {
    const old = new Date(now - (PRESENCE_STALE_AFTER_MS + 1000)).toISOString();
    expect(isStale(old, now)).toBe(true);
  });
});

describe("effectivePresence", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");
  const fresh = new Date(now - (PRESENCE_STALE_AFTER_MS - 1000)).toISOString();
  const stale = new Date(now - (PRESENCE_STALE_AFTER_MS + 1000)).toISOString();

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

describe("isReachableForDial", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");
  const fresh = new Date(now - (PRESENCE_STALE_AFTER_MS - 1000)).toISOString();
  const stale = new Date(now - (PRESENCE_STALE_AFTER_MS + 1000)).toISOString();

  it("is reachable when AVAILABLE or ON_CALL and the heartbeat is fresh", () => {
    expect(isReachableForDial("AVAILABLE", fresh, now)).toBe(true);
    // ON_CALL must be reachable too: an agent who just finished (or is wrapping up)
    // a call is briefly ON_CALL — common right after a video call, or pinned by a
    // leaked IN_PROGRESS row. Excluding them black-holed a real call in the pilot
    // smoke (the assigned agent was ON_CALL post-video → never dialed). Matches the
    // dashboard's "online" = AVAILABLE | ON_CALL definition.
    expect(isReachableForDial("ON_CALL", fresh, now)).toBe(true);
  });

  it("is not reachable when AWAY (opted out) or OFFLINE, even with a fresh heartbeat", () => {
    expect(isReachableForDial("AWAY", fresh, now)).toBe(false);
    expect(isReachableForDial("OFFLINE", fresh, now)).toBe(false);
  });

  it("is not reachable when the heartbeat is stale or missing, regardless of status", () => {
    expect(isReachableForDial("AVAILABLE", stale, now)).toBe(false);
    expect(isReachableForDial("ON_CALL", stale, now)).toBe(false);
    expect(isReachableForDial("AVAILABLE", null, now)).toBe(false);
  });
});

describe("constants + guards", () => {
  it("isLiveStatus accepts agent-settable statuses only", () => {
    expect(isLiveStatus("AVAILABLE")).toBe(true);
    expect(isLiveStatus("AWAY")).toBe(true);
    expect(isLiveStatus("ON_CALL")).toBe(true);
    expect(isLiveStatus("OFFLINE")).toBe(false);
    expect(isLiveStatus("bogus")).toBe(false);
  });
});

describe("roleHasPresence", () => {
  it("is true for call-takers (AGENT, ADMIN) who run a softphone", () => {
    expect(roleHasPresence("AGENT")).toBe(true);
    expect(roleHasPresence("ADMIN")).toBe(true);
  });

  it("is false for OWNER — no softphone, never heartbeats", () => {
    expect(roleHasPresence("OWNER")).toBe(false);
  });
});

describe("BREAK status (Task 9)", () => {
  const now = 1_000_000_000_000;
  const fresh = new Date(now - 5_000).toISOString();

  it("BREAK is a browser-settable live status", () => expect(isLiveStatus("BREAK")).toBe(true));
  it("BREAK is not dialed", () => expect(isReachableForDial("BREAK", fresh, now)).toBe(false));
  it("BREAK silences video", () => expect(isVideoSilencedStatus("BREAK")).toBe(true));
});
