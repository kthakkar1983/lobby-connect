/** Full-width seam hairline used at the top edge of the light screens. */
export function SeamTop() {
  return (
    <div
      className="absolute inset-x-0 top-0 z-10 h-[3px]"
      style={{ background: "var(--gradient-seam)" }}
      aria-hidden
    />
  );
}

/** Thin shimmering seam line for the loading state. */
export function SeamShimmer() {
  return <div className="lc-anim-shimmer h-[3px] w-36 rounded-full" aria-hidden />;
}
