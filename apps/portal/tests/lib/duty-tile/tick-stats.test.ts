import { describe, expect, it } from "vitest";
import {
  INITIAL_TICK_STATS,
  classifyGap,
  formatGap,
  recordTick,
} from "@/lib/duty-tile/tick-stats";

describe("recordTick", () => {
  it("records the first tick with no gap", () => {
    const s = recordTick(INITIAL_TICK_STATS, 10_000);
    expect(s).toEqual({ count: 1, lastTickAt: 10_000, lastGapMs: null, maxGapMs: null });
  });

  it("computes the gap from the previous tick", () => {
    const s1 = recordTick(INITIAL_TICK_STATS, 10_000);
    const s2 = recordTick(s1, 11_020);
    expect(s2.count).toBe(2);
    expect(s2.lastTickAt).toBe(11_020);
    expect(s2.lastGapMs).toBe(1_020);
    expect(s2.maxGapMs).toBe(1_020);
  });

  it("keeps the largest gap seen as maxGapMs", () => {
    let s = recordTick(INITIAL_TICK_STATS, 0);
    s = recordTick(s, 1_000); // gap 1000
    s = recordTick(s, 61_000); // gap 60000 — a throttled wake
    s = recordTick(s, 62_000); // gap 1000 again
    expect(s.lastGapMs).toBe(1_000);
    expect(s.maxGapMs).toBe(60_000);
    expect(s.count).toBe(4);
  });

  it("does not mutate the previous stats object", () => {
    const s1 = recordTick(INITIAL_TICK_STATS, 1_000);
    const frozen = { ...s1 };
    recordTick(s1, 2_000);
    expect(s1).toEqual(frozen);
  });
});

describe("classifyGap", () => {
  it("treats no data and ~1s gaps as ok", () => {
    expect(classifyGap(null)).toBe("ok");
    expect(classifyGap(1_000)).toBe("ok");
    expect(classifyGap(2_499)).toBe("ok");
  });

  it("flags multi-second gaps as degraded", () => {
    expect(classifyGap(2_500)).toBe("degraded");
    expect(classifyGap(9_999)).toBe("degraded");
  });

  it("flags >=10s gaps as throttled (Chrome intensive throttling is 1/min)", () => {
    expect(classifyGap(10_000)).toBe("throttled");
    expect(classifyGap(60_000)).toBe("throttled");
  });
});

describe("formatGap", () => {
  it("renders a dash for missing data", () => {
    expect(formatGap(null)).toBe("—");
  });

  it("renders seconds with one decimal", () => {
    expect(formatGap(0)).toBe("0.0s");
    expect(formatGap(1_020)).toBe("1.0s");
    expect(formatGap(60_000)).toBe("60.0s");
  });
});
