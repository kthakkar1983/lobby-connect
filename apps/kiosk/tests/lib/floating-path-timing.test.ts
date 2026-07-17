import { describe, expect, it } from "vitest";
import { pathTexture, pathTiming } from "@/lib/floating-path-timing";

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

// `pathTexture` breaks the machined look: the shipped width ramp (0.5 + i*0.03)
// and opacity ramp (0.1 + i*0.03) are perfectly linear, so the fan reads as
// uniform even frozen. A small per-path multiplier wobbles each line's weight
// and brightness around its ramp value — visible at a glance, at any speed —
// WITHOUT touching geometry, spacing, or direction.
describe("pathTexture", () => {
  it("is deterministic — identical inputs give identical output", () => {
    expect(pathTexture(7, 1)).toEqual(pathTexture(7, 1));
  });

  it("keeps the width multiplier within +/-25%", () => {
    for (const { index, position } of everyPath()) {
      const { widthMul } = pathTexture(index, position);
      expect(widthMul).toBeGreaterThanOrEqual(0.75);
      expect(widthMul).toBeLessThanOrEqual(1.25);
    }
  });

  it("keeps the opacity multiplier within +/-20% (faint lines never vanish, bright never blow out)", () => {
    for (const { index, position } of everyPath()) {
      const { opacityMul } = pathTexture(index, position);
      expect(opacityMul).toBeGreaterThanOrEqual(0.8);
      expect(opacityMul).toBeLessThanOrEqual(1.2);
    }
  });

  it("actually varies the ramps — not a constant multiplier", () => {
    // If every multiplier were 1.0 the texture would be a no-op. Assert real
    // spread across the field (distinct values), which is what breaks uniformity.
    const widths = everyPath().map(({ index, position }) => pathTexture(index, position).widthMul);
    const opacities = everyPath().map(({ index, position }) => pathTexture(index, position).opacityMul);
    expect(new Set(widths).size).toBeGreaterThan(60);
    expect(new Set(opacities).size).toBeGreaterThan(60);
  });
});
