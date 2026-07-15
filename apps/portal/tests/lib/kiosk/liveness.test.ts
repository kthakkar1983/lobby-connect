import { describe, it, expect } from "vitest";
import { isKioskOnline } from "@/lib/kiosk/liveness";
import { KIOSK_STALE_AFTER_MS } from "@lc/shared";

const NOW = 1_000_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isKioskOnline", () => {
  it("null last_seen_at is offline", () => {
    expect(isKioskOnline(null, NOW)).toBe(false);
  });
  it("unparseable timestamp is offline", () => {
    expect(isKioskOnline("not-a-date", NOW)).toBe(false);
  });
  it("a fresh heartbeat is online", () => {
    expect(isKioskOnline(iso(5_000), NOW)).toBe(true);
  });
  it("exactly at the staleness threshold is still online (inclusive)", () => {
    expect(isKioskOnline(iso(KIOSK_STALE_AFTER_MS), NOW)).toBe(true);
  });
  it("past the staleness threshold is offline", () => {
    expect(isKioskOnline(iso(KIOSK_STALE_AFTER_MS + 1), NOW)).toBe(false);
  });
});
