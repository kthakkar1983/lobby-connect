import { Captions, CaptionsOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * In-call captions on/off control. Shared by the audio + video overlays so the
 * affordance reads identically on both. Presentational — the enabled state lives
 * on CallSurfaceProvider (captionsEnabled / toggleCaptions), per-call and default
 * OFF; there is no persistence.
 *
 * ENABLED-STATE LABEL COLOUR IS SPLIT BY `compact`, AND THE RULE IS A WCAG ONE,
 * NOT A SURFACE ONE: text owes 4.5:1 (1.4.3), a lone icon owes 3:1 (1.4.11).
 *
 *   - Labelled (`compact === false`) renders only in the light control-bar tray,
 *     where `text-accent-text` on `bg-accent/10` composites to 3.81:1 and FAILS.
 *     `text-foreground` there is 11.86:1 — the same recipe <CallToggleButton>
 *     uses, so the two tray toggles cannot re-diverge.
 *   - Compact renders icon-only inside the navy call tile, where it clears the
 *     3:1 icon bar (3.12:1) and `text-foreground` would be navy-on-navy, i.e.
 *     1.0:1 and INVISIBLE. Do not "unify" the two branches.
 *
 * This control is enabled in both states, so the inactive-component exemption
 * never applies to it.
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
          ? cn("border-accent bg-accent/10", compact ? "text-accent-text" : "text-foreground")
          : "border-border text-text-muted",
        className,
      )}
    >
      {enabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
      {!compact && (enabled ? "Captions" : "Captions off")}
    </button>
  );
}
