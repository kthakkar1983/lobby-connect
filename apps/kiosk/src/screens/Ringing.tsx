import { useEffect, useRef } from "react";
import { Phone, ShieldCheck } from "lucide-react";
import type { VideoTrackHandle } from "../lib/video/types";
import { FloatingPaths } from "../components/floating-paths";
import { CallControls } from "./CallControls";
import { copy } from "../lib/copy";

export function Ringing({
  localVideo, muted, cameraOff, onMute, onCamera, onCancel,
}: {
  localVideo: VideoTrackHandle | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (localVideo && ref.current) localVideo.attach(ref.current);
  }, [localVideo]);

  return (
    <div className="relative h-full overflow-hidden" style={{ background: "var(--gradient-call-stage)" }}>
      <FloatingPaths position={1} className="text-accent" />
      <FloatingPaths position={-1} className="text-live" />

      {/* self-view PiP — top-right (consistent across every call stage) */}
      <div className="absolute right-5 top-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/40">
        <div ref={ref} className="absolute inset-0" />
        <span className="absolute bottom-1.5 left-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
          You
        </span>
      </div>

      {/* Decorative — must NOT capture taps, or it covers the Cancel button below. */}
      <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 px-10 text-center text-white">
        <div className="relative mb-2 grid size-32 place-items-center">
          <div className="seam-ring lc-anim-spin size-32 rounded-pill p-1" aria-hidden />
          <div className="absolute grid size-24 place-items-center rounded-pill bg-white/10">
            <Phone className="size-9" strokeWidth={1.6} />
          </div>
        </div>
        <div className="font-display text-3xl font-semibold">{copy.ringing.title}</div>
        <div className="font-mono text-sm text-white/65">{copy.ringing.subtitle}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-white/45">
          <ShieldCheck className="size-3.5" strokeWidth={1.8} />
          {copy.ringing.recordingNote}
        </div>
      </div>

      <CallControls
        muted={muted}
        cameraOff={cameraOff}
        onMute={onMute}
        onCamera={onCamera}
        primary={{ label: "Cancel", onClick: onCancel }}
        // Mic/camera are inert until their tracks exist (assigned with localVideo
        // after joinLiveKit resolves) — greyed while still dialing, live the moment
        // the tracks are ready (still during ringing, before the agent answers).
        disabled={!localVideo}
      />
    </div>
  );
}
