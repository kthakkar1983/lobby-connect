// Per-path animation timing for the kiosk's FloatingPaths (components/
// floating-paths.tsx). Pure + deterministic: called at render with no state,
// stable across reloads (and safe if ever shared with the SSR'd portal).
//
// Replaces the shipped `duration: 40 + (index % 16)` — which gave only 16
// distinct periods across 36 paths and started every line in unison, so the
// field visibly moved in welded groups. Here each line gets its own period and
// its own phase, so the lines stagger.

/** Deterministic pseudo-random in [0, 1) from an integer seed + salt (GLSL-style
 *  sine hash). No Math.random() — output must be identical on every render. */
function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface PathTiming {
  /** Animation period in seconds — spread over 34–58s so no two paths match. */
  readonly durationSec: number;
  /** Negative CSS animation-delay: seeks the line into a random point of its own
   *  cycle so nothing starts at the 0% frame in unison. In (-durationSec, 0]. */
  readonly delaySec: number;
}

export function pathTiming(index: number, position: number): PathTiming {
  // The two FloatingPaths instances share index 0..35; offset one seed space so
  // the mirrored fields don't animate identically.
  const seed = position === 1 ? index : index + 100;
  const durationSec = 34 + seededUnit(seed, 1) * 24; // [34, 58)
  const delaySec = -seededUnit(seed, 2) * durationSec; // (-durationSec, 0]
  return { durationSec, delaySec };
}
