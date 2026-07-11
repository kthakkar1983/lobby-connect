import { Captions, CaptionsOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * In-call captions on/off control. Shared by the audio + video overlays so the
 * affordance reads identically on both. Presentational — the enabled state lives
 * on CallSurfaceProvider (captionsEnabled / toggleCaptions), per-call and default
 * OFF; there is no persistence.
 */
export function CaptionToggle({
  enabled,
  onToggle,
  className,
}: {
  readonly enabled: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      title={enabled ? "Turn captions off" : "Turn captions on"}
      className={cn(
        "flex items-center gap-1 rounded-button border px-3 py-2 text-sm",
        enabled
          ? "border-accent bg-accent/10 text-accent-text"
          : "border-border text-text-muted",
        className,
      )}
    >
      {enabled ? <Captions size={16} /> : <CaptionsOff size={16} />}
      {enabled ? "Captions" : "Captions off"}
    </button>
  );
}
