"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { pathMotion } from "@/lib/brand/path-motion";

/**
 * Animated "connection lines" for the sign-in brand panel — a drifting field of
 * curved strokes that echoes the brand seam (a line joining two points).
 *
 * Adapted from the efferd `floating-paths` block: colour comes from the parent
 * via `currentColor` (set a brand text token through `className`), durations are
 * deterministic to avoid SSR hydration drift, and motion honours
 * `prefers-reduced-motion` — the global CSS net at globals.css can't reach
 * motion's JS-driven animation, so we guard here.
 */
export function FloatingPaths({
  position,
  className,
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
      <svg
        className={cn("h-full w-full", className)}
        fill="none"
        viewBox="0 0 696 316"
      >
        {paths.map((path) => {
          const anim = pathMotion(!!reduceMotion, 20 + (path.id % 10));
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
