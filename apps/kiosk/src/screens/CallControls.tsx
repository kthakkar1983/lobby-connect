import type { ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

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
      ? "bg-card text-call" // neutral solid reads on the dark video stage (red stays 911-only)
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
      <span className="text-[11px] font-medium text-white/80">{label}</span>
    </button>
  );
}

export function CallControls({
  muted, cameraOff, onMute, onCamera, primary, disabled = false,
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
}) {
  return (
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-end gap-3 rounded-pill border border-white/10 bg-call/70 px-3 py-2.5 backdrop-blur-sm">
      <Ctrl label={muted ? "Unmute" : "Mute"} onClick={onMute} disabled={disabled}>
        {muted ? <MicOff /> : <Mic />}
      </Ctrl>
      <Ctrl label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera} disabled={disabled}>
        {cameraOff ? <VideoOff /> : <Video />}
      </Ctrl>
      <Ctrl label={primary.label} onClick={primary.onClick} variant="end">
        <PhoneOff />
      </Ctrl>
    </div>
  );
}
