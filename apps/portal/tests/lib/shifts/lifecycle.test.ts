import { describe, it, expect } from "vitest";
import { SESSION_MAX_MS } from "@lc/shared";
import {
  classifyShiftEnd,
  canDoWork,
  computeClockedSeconds,
  computeUtilization,
} from "@/lib/shifts/lifecycle";

const iso = (ms: number) => new Date(ms).toISOString();

describe("classifyShiftEnd", () => {
  it("near the cap is 'capped'", () => {
    const start = 0;
    const end = SESSION_MAX_MS - 60_000; // 1 min under 12h
    expect(classifyShiftEnd(iso(start), iso(end), SESSION_MAX_MS)).toBe("capped");
  });
  it("a short shift is 'lapsed'", () => {
    expect(classifyShiftEnd(iso(0), iso(3 * 60 * 60 * 1000), SESSION_MAX_MS)).toBe("lapsed");
  });
});

describe("canDoWork", () => {
  // Duty is raw-status: canDoWork no longer takes last_seen/now. A stale
  // heartbeat (throttled portal tab behind foregrounded RustDesk) is the normal
  // working posture and must still be allowed to work — only OFFLINE/BREAK block.
  it("AVAILABLE -> true", () => expect(canDoWork("AVAILABLE")).toBe(true));
  it("AWAY -> true (heads-down remote work allowed)", () => expect(canDoWork("AWAY")).toBe(true));
  it("ON_CALL -> true", () => expect(canDoWork("ON_CALL")).toBe(true));
  it("BREAK -> false (not working on break)", () => expect(canDoWork("BREAK")).toBe(false));
  it("OFFLINE -> false (off duty)", () => expect(canDoWork("OFFLINE")).toBe(false));
});

describe("computeClockedSeconds", () => {
  const now = 100_000_000;
  it("closed shift = ended - started", () =>
    expect(computeClockedSeconds(iso(0), iso(3600_000), null, now)).toBe(3600));
  it("open fresh shift = now - started", () =>
    expect(computeClockedSeconds(iso(now - 3600_000), null, iso(now - 10_000), now)).toBe(3600));
  it("open STALE shift = lastSeen - started (effective end)", () =>
    expect(computeClockedSeconds(iso(0), null, iso(1800_000), now)).toBe(1800));
});

describe("computeUtilization", () => {
  it("talk / clocked, clamped, rounded", () => {
    expect(computeUtilization(3600, 900)).toBe(25);
    expect(computeUtilization(0, 0)).toBe(0);
    expect(computeUtilization(100, 200)).toBe(100); // clamp >100
  });
});
