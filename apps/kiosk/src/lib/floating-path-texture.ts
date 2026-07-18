// Per-path texture for the kiosk's FloatingPaths (components/floating-paths.tsx).
// Pure + deterministic: called at render with no state, stable across reloads.
//
// The shipped width ramp (0.5 + i*0.03) and opacity ramp (0.1 + i*0.03) are
// perfectly linear, so the fan looks machined. `pathTexture` returns a small
// per-path multiplier that wobbles each line's weight and brightness around its
// ramp value — the "organic, not uniform" look.
//
// This is STATIC per-path variation only (strokeWidth / strokeOpacity). It is
// applied to the existing `motion`-driven animation WITHOUT changing the
// animation, so it cannot affect animation smoothness (the reason the pure-CSS
// stroke-dash rewrite was reverted — see memory kiosk-css-animation-reverted).

/** Deterministic pseudo-random in [0, 1) from an integer seed + salt (GLSL-style
 *  sine hash). No Math.random() — output must be identical on every render. */
function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface PathTexture {
  /** Multiplier on the base stroke width — wobbles line weight +/-25%. */
  readonly widthMul: number;
  /** Multiplier on the base stroke opacity — wobbles brightness +/-20%
   *  (gentler than width so faint lines don't vanish or bright ones blow out). */
  readonly opacityMul: number;
}

export function pathTexture(index: number, position: number): PathTexture {
  // The two FloatingPaths instances share index 0..35; offset one seed space so
  // the mirrored fields don't resolve to identical texture.
  const seed = position === 1 ? index : index + 100;
  const widthMul = 0.75 + seededUnit(seed, 3) * 0.5; // [0.75, 1.25)
  const opacityMul = 0.8 + seededUnit(seed, 4) * 0.4; // [0.80, 1.20)
  return { widthMul, opacityMul };
}
