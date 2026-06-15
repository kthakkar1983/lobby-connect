import type { ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff } from "lucide-react";

function Ctrl({
  label, onClick, children, variant = "ghost",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  variant?: "ghost" | "end";
}) {
  const base =
    "grid size-14 place-items-center rounded-pill transition-transform active:scale-95 [&_svg]:size-6";
  const skin =
    variant === "end"
      ? "bg-card text-call" // neutral solid reads on the dark video stage (red stays 911-only)
      : "border border-white/25 bg-white/10 text-white";
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex flex-col items-center gap-1.5">
      <span className={`${base} ${skin}`}>{children}</span>
      <span className="text-[11px] font-medium text-white/80">{label}</span>
    </button>
  );
}

export function CallControls({
  muted, cameraOff, onMute, onCamera, primary,
}: {
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  primary: { label: string; onClick: () => void };
}) {
  return (
    <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-end gap-3 rounded-pill border border-white/10 bg-call/70 px-3 py-2.5 backdrop-blur-sm">
      <Ctrl label={muted ? "Unmute" : "Mute"} onClick={onMute}>
        {muted ? <MicOff /> : <Mic />}
      </Ctrl>
      <Ctrl label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera}>
        {cameraOff ? <VideoOff /> : <Video />}
      </Ctrl>
      <Ctrl label={primary.label} onClick={primary.onClick} variant="end">
        <PhoneOff />
      </Ctrl>
    </div>
  );
}
