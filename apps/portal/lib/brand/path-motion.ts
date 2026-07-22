// The motion props for one connection-line stroke. Reduced motion draws the
// FULL static line (pathLength 1) instead of the animated seed's 30% stub, so
// prefers-reduced-motion shows complete lines, not fragments.
export function pathMotion(reduceMotion: boolean, animatedDuration: number) {
  if (reduceMotion) {
    return { initial: { pathLength: 1, opacity: 0.6 }, animate: undefined, transition: undefined } as const;
  }
  return {
    initial: { pathLength: 0.3, opacity: 0.6 },
    animate: { pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] },
    transition: { duration: animatedDuration, repeat: Number.POSITIVE_INFINITY, ease: "linear" as const },
  };
}
