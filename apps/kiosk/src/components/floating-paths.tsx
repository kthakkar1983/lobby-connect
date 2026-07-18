import { motion, useReducedMotion } from "motion/react";

import { pathTexture } from "../lib/floating-path-texture";

/**
 * Animated "connection lines" — the kiosk copy of the portal's sign-in
 * `components/brand/floating-paths.tsx` (same geometry and motion), so the
 * kiosk's navy panels match the login screen. The kiosk is a separate build
 * graph, so the component is duplicated rather than imported.
 *
 * Per-path `pathTexture` wobbles each line's stroke width (+/-25%) and opacity
 * (+/-20%) around the base ramps so the fan reads organic instead of machined.
 * That is STATIC per-path variation only — the `motion` animation below is
 * untouched, so smoothness is identical to the plain version (the pure-CSS
 * stroke-dash rewrite was reverted for juddering; see memory
 * kiosk-css-animation-reverted).
 *
 * Colour comes from the parent via `currentColor` (set a brand text token through
 * `className`); durations are deterministic (no SSR here, but kept identical);
 * motion honours `prefers-reduced-motion` — the index.css net can't reach
 * motion's JS-driven animation, so we guard here.
 */
export function FloatingPaths({
  position,
  className = "",
}: {
  readonly position: number;
  readonly className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const paths = Array.from({ length: 36 }, (_, i) => {
    const { widthMul, opacityMul } = pathTexture(i, position);
    return {
      id: i,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
        380 - i * 5 * position
      } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
        152 - i * 5 * position
      } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
        684 - i * 5 * position
      } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
      // Base ramps wobbled per-path (organic, not machined) — static only.
      width: (0.5 + i * 0.03) * widthMul,
      opacity: (0.1 + i * 0.03) * opacityMul,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg className={`h-full w-full ${className}`} fill="none" viewBox="0 0 696 316">
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            initial={{ pathLength: 0.3, opacity: 0.6 }}
            animate={
              reduceMotion
                ? undefined
                : {
                    pathLength: 1,
                    opacity: [0.3, 0.6, 0.3],
                    pathOffset: [0, 1, 0],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    duration: 40 + (path.id % 16), // kiosk: ~2x slower than the login for a calmer feel
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }
            }
          />
        ))}
      </svg>
    </div>
  );
}
