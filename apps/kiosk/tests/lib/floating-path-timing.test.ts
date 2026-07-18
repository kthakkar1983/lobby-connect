import { describe, expect, it } from "vitest";
import { pathTiming } from "@/lib/floating-path-timing";

// The kiosk's FloatingPaths renders two SVG instances (position 1 and -1), 36
// paths each = 72 lines. `pathTiming` replaces the shipped
// `duration: 40 + (index % 16)` (only 16 distinct periods, every path starting
// in unison) with a per-path duration + negative phase offset, so the field
// looks staggered instead of breathing as one organism. It must be pure and
// deterministic — the component computes it at render with no state, and the
// portal equivalent must not drift across SSR/hydration if this is ever shared.

const POSITIONS = [1, -1] as const;
const PATH_COUNT = 36;

function everyPath(): Array<{ index: number; position: number }> {
  const out: Array<{ index: number; position: number }> = [];
  for (const position of POSITIONS) {
    for (let index = 0; index < PATH_COUNT; index++) out.push({ index, position });
  }
  return out;
}

describe("pathTiming", () => {
  it("is deterministic — identical inputs give identical output", () => {
    const a = pathTiming(7, 1);
    const b = pathTiming(7, 1);
    expect(b).toEqual(a);
  });

  it("keeps every duration within the 34–58s spread", () => {
    for (const { index, position } of everyPath()) {
      const { durationSec } = pathTiming(index, position);
      expect(durationSec).toBeGreaterThanOrEqual(34);
      expect(durationSec).toBeLessThan(58);
    }
  });

  it("offsets the start into the past without exceeding one full period", () => {
    // A negative delay in (-duration, 0] seeks the animation into a random point
    // of its own cycle. Staying within one period guarantees every line is
    // mid-flight on first paint (no line sitting frozen at its 0% frame).
    for (const { index, position } of everyPath()) {
      const { durationSec, delaySec } = pathTiming(index, position);
      expect(delaySec).toBeLessThanOrEqual(0);
      expect(delaySec).toBeGreaterThan(-durationSec);
    }
  });

  it("gives all 72 paths a distinct period — no lockstep groups", () => {
    // The whole point: the old `% 16` scheme welded paths 0/16/32 (etc.) to an
    // identical period so they moved as one. Distinct periods break that.
    const durations = everyPath().map(({ index, position }) => pathTiming(index, position).durationSec);
    expect(new Set(durations).size).toBe(durations.length);
  });
});
