import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, hexToRgb } from "@/lib/theme/contrast";

describe("contrastRatio", () => {
  it("returns 21:1 for black on white (the WCAG maximum)", () => {
    expect(contrastRatio(hexToRgb("#000000"), hexToRgb("#FFFFFF"))).toBeCloseTo(21, 5);
  });

  it("returns 1:1 for identical colors", () => {
    expect(contrastRatio(hexToRgb("#2EA6AA"), hexToRgb("#2EA6AA"))).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = hexToRgb("#048765");
    const b = hexToRgb("#FFFFFF");
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("matches the known ratio of deep mint #048765 on pure white (~4.51:1)", () => {
    expect(contrastRatio(hexToRgb("#048765"), hexToRgb("#FFFFFF"))).toBeCloseTo(4.51, 2);
  });
});

describe("compositeOver", () => {
  it("returns the base color at alpha 0 (fully transparent overlay)", () => {
    const base = hexToRgb("#F4F7F7");
    expect(compositeOver(hexToRgb("#06D6A0"), 0, base)).toEqual(base);
  });

  it("returns the overlay color at alpha 1 (fully opaque overlay)", () => {
    const fg = hexToRgb("#06D6A0");
    expect(compositeOver(fg, 1, hexToRgb("#FFFFFF"))).toEqual(fg);
  });

  it("reproduces why the mint chip fails: #048765 text on bg-live/15 over white is ~4.03:1", () => {
    // The token clears 4.51:1 on *pure* white, but the 15% mint tint darkens the
    // effective background enough to drop it below the 4.5:1 normal-text bar.
    const chipBg = compositeOver(hexToRgb("#06D6A0"), 0.15, hexToRgb("#FFFFFF"));
    expect(contrastRatio(hexToRgb("#048765"), chipBg)).toBeCloseTo(4.03, 2);
  });
});
