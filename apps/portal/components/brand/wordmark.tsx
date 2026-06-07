import { cn } from "@/lib/utils";

/** The "LC" seam mark — navy tile, seam-gradient hairline underneath (motif = "connected"). */
export function LogoMark({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-primary text-primary-foreground text-xs font-semibold",
        className
      )}
      aria-hidden
    >
      LC
      <span
        className="absolute inset-x-1 -bottom-px h-px rounded-full"
        style={{ background: "var(--gradient-seam)" }}
      />
    </span>
  );
}

/** Full wordmark: mark + "LOBBY CONNECT" in the label face. */
export function Wordmark({
  className,
  hideTextWhenCollapsed = false,
}: {
  readonly className?: string;
  readonly hideTextWhenCollapsed?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span
        className={cn(
          "text-sm font-semibold tracking-[0.12em] text-foreground uppercase",
          hideTextWhenCollapsed && "group-data-[collapsible=icon]:hidden"
        )}
        style={{ fontFamily: "var(--font-label)" }}
      >
        Lobby Connect
      </span>
    </span>
  );
}
