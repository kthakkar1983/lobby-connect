import { motion, useReducedMotion } from "motion/react";

import { pathMotion } from "@/lib/path-motion";

/**
 * Animated "connection lines" — the kiosk copy of the portal's sign-in
 * `components/brand/floating-paths.tsx` (same geometry, widths, opacities, and
 * motion), so the kiosk's navy panels match the login screen exactly. The kiosk
 * is a separate build graph, so the component is duplicated rather than imported.
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

  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
      380 - i * 5 * position
    } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
      152 - i * 5 * position
    } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }));

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg className={`h-full w-full ${className}`} fill="none" viewBox="0 0 696 316">
        {paths.map((path) => {
          // kiosk: ~2x slower than the login for a calmer feel
          const anim = pathMotion(!!reduceMotion, 40 + (path.id % 16));
          return (
            <motion.path
              key={path.id}
              d={path.d}
              stroke="currentColor"
              strokeWidth={path.width}
              strokeOpacity={0.1 + path.id * 0.03}
              initial={anim.initial}
              animate={anim.animate}
              transition={anim.transition}
            />
          );
        })}
      </svg>
    </div>
  );
}
