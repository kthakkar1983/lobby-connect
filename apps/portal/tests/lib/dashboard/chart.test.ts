import { describe, it, expect } from "vitest";

import { niceAxisMax, axisTicks } from "@/lib/dashboard/chart";

describe("niceAxisMax", () => {
  it("floors at 3 so a quiet night still shows a readable scale", () => {
    expect(niceAxisMax(0)).toBe(3);
    expect(niceAxisMax(1)).toBe(3);
    expect(niceAxisMax(3)).toBe(3);
  });

  it("rounds up to the next multiple of 3 so the thirds are whole numbers", () => {
    expect(niceAxisMax(4)).toBe(6);
    expect(niceAxisMax(5)).toBe(6);
    expect(niceAxisMax(6)).toBe(6);
    expect(niceAxisMax(7)).toBe(9);
  });

  it("never returns a fractional or negative max", () => {
    expect(niceAxisMax(-5)).toBe(3);
    expect(Number.isInteger(niceAxisMax(13))).toBe(true);
  });
});

describe("axisTicks", () => {
  it("returns four whole-number ticks top→bottom ending at zero", () => {
    expect(axisTicks(1)).toEqual([3, 2, 1, 0]);
    expect(axisTicks(5)).toEqual([6, 4, 2, 0]);
    expect(axisTicks(9)).toEqual([9, 6, 3, 0]);
  });

  it("keeps every tick an integer", () => {
    for (const t of axisTicks(13)) expect(Number.isInteger(t)).toBe(true);
  });
});
