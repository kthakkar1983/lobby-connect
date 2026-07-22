import { describe, it, expect } from "vitest";
import { pathMotion } from "@/lib/brand/path-motion";

describe("pathMotion", () => {
  it("reduced motion → a full static line, no animation", () => {
    const m = pathMotion(true, 25);
    expect(m.initial).toEqual({ pathLength: 1, opacity: 0.6 });
    expect(m.animate).toBeUndefined();
    expect(m.transition).toBeUndefined();
  });
  it("full motion → the drifting animation with the given duration", () => {
    const m = pathMotion(false, 25);
    expect(m.initial).toEqual({ pathLength: 0.3, opacity: 0.6 });
    expect(m.animate).toEqual({ pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] });
    expect(m.transition).toEqual({ duration: 25, repeat: Number.POSITIVE_INFINITY, ease: "linear" });
  });
});
