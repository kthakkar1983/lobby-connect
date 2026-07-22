import type { ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare } from "lucide-react";

function Ctrl({
  label, onClick, children, variant = "ghost", disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  variant?: "ghost" | "end";
  disabled?: boolean;
}) {
  const base =
    "grid size-14 place-items-center rounded-pill transition-transform [&_svg]:size-6";
  const skin =
    variant === "end"
      ? // Blaze fill, matching the agent side (agent End call is blaze on both the
        // overlay and the tile). Blaze is NOT red — 911 has no kiosk path — so the
        // terminating control reads consistently across the guest and agent
        // surfaces without becoming an alarm colour (2026-07-21 smoke).
        "bg-attention text-attention-foreground"
      : "border border-white/25 bg-white/10 text-white";
  // Greyed + inert until the control can actually work (see CallControls `disabled`).
  const state = disabled ? "opacity-40" : "active:scale-95";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex flex-col items-center gap-1.5 disabled:cursor-not-allowed"
    >
      <span className={`${base} ${skin} ${state}`}>{children}</span>
      {/* Fixed-width + non-wrapping so a label swap (Mute<->Unmute, Camera
          off<->on) changes only the TEXT, never the box — which would
          otherwise change this control's width, and with it the whole bar's
          width, shoving every control after it sideways mid-call. w-16 (64px)
          was checked against the real "Outfit" 500-weight font at this size:
          the widest label, "Camera off", measures ~55.6px — comfortable
          headroom under 64px. */}
      <span className="w-16 text-center whitespace-nowrap text-[11px] font-medium text-white/80">
        {label}
      </span>
    </button>
  );
}

export function CallControls({
  muted, cameraOff, onMute, onCamera, primary, disabled = false, onType,
}: {
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  primary: { label: string; onClick: () => void };
  // Greys out mic + camera while their tracks don't exist yet (the connecting
  // phase). The guest can't actuate a control that would silently no-op —
  // muting before the agent answers used to look muted but leave the mic live
  // for the whole call. `primary` (Cancel/End) is NEVER disabled.
  disabled?: boolean;
  // Opens the in-call chat panel. Optional: Ringing renders CallControls
  // without it and gets today's Mute/Camera/primary bar unchanged; Connected
  // passes it and gains a "Type" control. Always enabled — the guest may open
  // chat any time, even before mic/camera tracks exist.
  onType?: () => void;
}) {
  return (
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-pill border border-white/10 bg-call/70 px-4 py-2.5 backdrop-blur-sm">
      <Ctrl label={muted ? "Unmute" : "Mute"} onClick={onMute} disabled={disabled}>
        {muted ? <MicOff /> : <Mic />}
      </Ctrl>
      <Ctrl label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera} disabled={disabled}>
        {cameraOff ? <VideoOff /> : <Video />}
      </Ctrl>
      {onType && (
        <Ctrl label="Type" onClick={onType}>
          <MessageSquare />
        </Ctrl>
      )}
      <Ctrl label={primary.label} onClick={primary.onClick} variant="end">
        <PhoneOff />
      </Ctrl>
    </div>
  );
}
