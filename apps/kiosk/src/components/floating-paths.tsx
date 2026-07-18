import type { CSSProperties } from "react";
import { pathTiming } from "../lib/floating-path-timing";

/**
 * Animated "connection lines" — the kiosk copy of the portal's sign-in
 * `components/brand/floating-paths.tsx` (same geometry, widths, and opacities),
 * so the kiosk's navy panels match the login screen. The kiosk is a separate
 * build graph, so the component is duplicated rather than imported.
 *
 * Pure CSS: each path is a normalised (`pathLength={1}`) stroke whose dash flows
 * via the `lc-floating-path` keyframe in index.css, with a per-path period +
 * phase from `pathTiming` so the lines stagger instead of moving in unison. No
 * `motion` dependency and no JS animation loop — the reduced-motion net in
 * index.css reaches it directly (a plain CSS animation), so no JS guard is
 * needed. Colour comes from the parent via `currentColor` (set a brand text
 * token through `className`).
 */
export function FloatingPaths({
  position,
  className = "",
}: {
  readonly position: number;
  readonly className?: string;
}) {
  const paths = Array.from({ length: 36 }, (_, i) => {
    const { durationSec, delaySec } = pathTiming(i, position);
    return {
      id: i,
      d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
        380 - i * 5 * position
      } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
        152 - i * 5 * position
      } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
        684 - i * 5 * position
      } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
      width: 0.5 + i * 0.03,
      opacity: 0.1 + i * 0.03,
      durationSec,
      delaySec,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg className={`h-full w-full ${className}`} fill="none" viewBox="0 0 696 316">
        {paths.map((path) => (
          <path
            key={path.id}
            className="lc-floating-path"
            d={path.d}
            pathLength={1}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            style={
              {
                "--lc-dur": `${path.durationSec.toFixed(2)}s`,
                "--lc-delay": `${path.delaySec.toFixed(2)}s`,
              } as CSSProperties
            }
          />
        ))}
      </svg>
    </div>
  );
}
