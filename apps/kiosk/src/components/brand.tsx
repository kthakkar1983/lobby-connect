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

/** The "LC" seam mark (kiosk copy of the portal LogoMark). */
export function LogoMark({ className = "" }: { readonly className?: string }) {
  return (
    <span
      className={`relative inline-flex size-9 shrink-0 items-center justify-center rounded-input bg-primary text-sm font-semibold text-primary-foreground ${className}`}
      aria-hidden
    >
      LC
      <span
        className="absolute inset-x-1.5 -bottom-px h-px rounded-full"
        style={{ background: "var(--gradient-seam)" }}
      />
    </span>
  );
}

/** Thin shimmering seam line for the loading state. */
export function SeamShimmer() {
  return <div className="lc-anim-shimmer h-[3px] w-36 rounded-full" aria-hidden />;
}
