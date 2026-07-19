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
 *   - Labelled (`compact === false`) renders only in the light control-bar tray.
 *     Enabled: `text-foreground` on `bg-accent/10` = 11.86:1 (the same recipe
 *     <CallToggleButton> uses, so the two tray toggles cannot re-diverge);
 *     `text-accent-text` there was only 3.81:1 and FAILED. Off: `text-text-muted`
 *     on white = 5.48:1, with the visible "Captions off" label.
 *   - Compact renders icon-only inside the navy call tile, whose ROOT is
 *     `bg-primary` #0F2D4B (call-tile.tsx:219; the control bar at :299 has no
 *     fill, so the navy shows through — this is NOT the #14202F video stage an
 *     earlier comment mistakenly measured against). On that navy the old colours
 *     FAILED the 3:1 icon bar: `text-accent-text` was ~2.68:1 over the
 *     bg-accent/10 composite, `text-text-muted` ~2.56:1. Corrected — enabled
 *     `text-accent` (bright teal, matching the border) ~4.1:1 over that
 *     composite; off `text-primary-foreground/70` ~7.6:1 on the navy, matching
 *     the sibling Video/Chat toggle. `text-foreground` would be navy-on-navy
 *     (~1.0:1, INVISIBLE), so do NOT "unify" the two branches.
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
      title={enabled ? "Turn captions off" : "Turn captions on"}
      className={cn(
        "flex items-center gap-1 rounded-button border text-sm",
        compact ? "px-2 py-2" : "px-3 py-2",
        enabled
          ? cn("border-accent bg-accent/10", compact ? "text-accent" : "text-foreground")
          : cn("border-border", compact ? "text-primary-foreground/70" : "text-text-muted"),
        className,
      )}
    >
      {enabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
      {!compact && (enabled ? "Captions" : "Captions off")}
    </button>
  );
}
