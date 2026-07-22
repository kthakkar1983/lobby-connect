import { Captions, CaptionsOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * In-call captions on/off control. Shared by the audio + video overlays so the
 * affordance reads identically on both. Presentational — the enabled state lives
 * on CallSurfaceProvider (captionsEnabled / toggleCaptions), per-call and default
 * OFF; there is no persistence.
 *
 * ICON/LABEL COLOUR IS SPLIT BY `compact`, AND THE RULE IS A WCAG ONE, NOT A
 * SURFACE ONE: a label owes 4.5:1 (1.4.3), a lone icon owes 3:1 (1.4.11). BOTH
 * states of this control are ENABLED, so the inactive-component exemption never
 * applies — every colour below is measured against the surface it renders on.
 *
 *   - Labelled (`compact === false`) renders directly on the control bar's
 *     `bg-card` (#FFFFFF) — lifted out of the old tray in the 2026-07-20 bar
 *     reorder (spec §3.1). Enabled: `text-foreground` on `bg-accent/10` over
 *     bg-card = 12.71:1 (the same recipe <CallToggleButton> uses, so the two
 *     toggles cannot re-diverge; `text-accent-text` there would be ~5.40:1 — it
 *     passes now, but text-foreground keeps more margin). Off: `text-text-muted`
 *     on `bg-card` = 5.48:1, with the visible "Captions off" label.
 *   - Compact renders icon-only inside the navy call tile, whose ROOT is
 *     `bg-primary` #0F2D4B (call-tile.tsx:219; the control bar at :299 has no
 *     fill, so the navy shows through — this is NOT the #14202F video stage an
 *     earlier comment mistakenly measured against). On that navy the deep-text
 *     tokens FAILED the 3:1 icon bar (`text-accent-text` ~2.68:1 over the
 *     bg-accent/10 composite, `text-text-muted` ~2.56:1 — measured against the
 *     pre-1ef6ee8 tokens; the 2026-07-19 darkening lifts them slightly but not
 *     past 3:1 here). Corrected — enabled `text-accent` (bright teal fill token,
 *     matching the border) ~4.1:1 over that composite; off
 *     `text-primary-foreground/70` ~7.6:1 on the navy, matching the sibling
 *     Video/Chat toggle. `text-foreground` would be navy-on-navy (~1.0:1,
 *     INVISIBLE), so do NOT "unify" the two branches.
 */
export function CaptionToggle({
  enabled,
  onToggle,
  className,
  compact = false,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
  readonly compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      /* Compact drops the visible label (below), leaving `title` as the only
         accessible name — and title is an unreliable name source (the sibling
         <CallToggleButton> documents and measures this: name-from-content wins
         over title, and AT commonly drops it). Give the compact icon-only
         toggle a stable explicit name; aria-pressed still carries on/off. The
         labelled branch keeps its name from the visible text. */
      aria-label={compact ? "Captions" : undefined}
      title={enabled ? "Turn captions off" : "Turn captions on"}
      className={cn(
        "flex items-center gap-1 rounded-button border text-sm",
        compact ? "px-2 py-1 text-xs" : "px-3 py-2",
        enabled
          ? cn("border-accent bg-accent/10", compact ? "text-accent" : "text-foreground")
          : cn("border-border", compact ? "text-primary-foreground/70" : "text-text-muted"),
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        compact
          ? "focus-visible:ring-primary-foreground focus-visible:ring-offset-primary"
          : "focus-visible:ring-ring focus-visible:ring-offset-background",
        className,
      )}
    >
      {enabled ? <Captions size={compact ? 13 : 14} /> : <CaptionsOff size={compact ? 13 : 14} />}
      {!compact && (enabled ? "Captions" : "Captions off")}
    </button>
  );
}
