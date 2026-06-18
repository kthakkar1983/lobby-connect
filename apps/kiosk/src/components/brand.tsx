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

/** Drifting connection-lines field (CSS-animated; the kiosk's dependency-free
 *  echo of the portal floating-paths). Honors prefers-reduced-motion via index.css. */
export function ConnectionLines({ className = "" }: { readonly className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox="0 0 260 280"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <g className="lc-cl-layer" strokeWidth="1.1">
        <path className="lc-cl-path stroke-accent" style={{ animationDelay: "0s" }}
          d="M-10 70 C60 40 110 120 190 88 S300 84 340 108" />
        <path className="lc-cl-path stroke-live" style={{ animationDelay: "-2s" }}
          d="M-10 150 C70 120 120 200 210 160 S300 158 345 176" />
        <path className="lc-cl-path stroke-accent" style={{ animationDelay: "-4s" }}
          d="M-10 220 C80 192 130 250 220 214 S300 220 345 232" />
      </g>
    </svg>
  );
}
