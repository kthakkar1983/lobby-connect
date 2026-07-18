import { describe, expect, it } from "vitest";
import { pathTexture } from "@/lib/floating-path-texture";

// pathTexture breaks the machined look of the kiosk FloatingPaths: the shipped
// width ramp (0.5 + i*0.03) and opacity ramp (0.1 + i*0.03) are perfectly
// linear, so the fan reads as uniform. A small deterministic per-path multiplier
// wobbles each line's weight and brightness around its ramp value. This is
// STATIC per-path variation (strokeWidth / strokeOpacity) — it is applied to the
// existing smooth `motion` animation without touching the animation itself.

const POSITIONS = [1, -1] as const;
const PATH_COUNT = 36;

function everyPath(): Array<{ index: number; position: number }> {
  const out: Array<{ index: number; position: number }> = [];
  for (const position of POSITIONS) {
    for (let index = 0; index < PATH_COUNT; index++) out.push({ index, position });
  }
  return out;
}

describe("pathTexture", () => {
  it("is deterministic — identical inputs give identical output", () => {
    expect(pathTexture(7, 1)).toEqual(pathTexture(7, 1));
  });

  it("distinguishes the two mirrored path fields (position 1 vs -1)", () => {
    // Home renders two instances sharing index 0..35; they must not resolve to
    // identical texture or the mirror looks copy-pasted.
    expect(pathTexture(5, 1)).not.toEqual(pathTexture(5, -1));
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
    const widths = everyPath().map(({ index, position }) => pathTexture(index, position).widthMul);
    const opacities = everyPath().map(({ index, position }) => pathTexture(index, position).opacityMul);
    expect(new Set(widths).size).toBeGreaterThan(60);
    expect(new Set(opacities).size).toBeGreaterThan(60);
  });
});
