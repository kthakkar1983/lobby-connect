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
  const now = 1_000_000_000_000;
  const fresh = iso(now - 10_000);
  it("AVAILABLE fresh -> true", () => expect(canDoWork("AVAILABLE", fresh, now)).toBe(true));
  it("AWAY fresh -> true (heads-down remote work allowed)", () => expect(canDoWork("AWAY", fresh, now)).toBe(true));
  it("ON_CALL fresh -> true", () => expect(canDoWork("ON_CALL", fresh, now)).toBe(true));
  it("BREAK fresh -> false (not working on break)", () => expect(canDoWork("BREAK", fresh, now)).toBe(false));
  it("OFFLINE -> false", () => expect(canDoWork("OFFLINE", fresh, now)).toBe(false));
  it("stale AVAILABLE -> false (shift lapsed)", () =>
    expect(canDoWork("AVAILABLE", iso(now - 5 * 60_000), now)).toBe(false));
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
