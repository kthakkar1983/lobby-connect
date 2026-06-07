import { useEffect, useRef } from "react";
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";
import { Phone } from "lucide-react";
import { CallControls } from "./CallControls";

export function Ringing({
  localVideo, muted, cameraOff, onMute, onCamera, onCancel,
}: {
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (localVideo && ref.current) localVideo.play(ref.current);
  }, [localVideo]);

  return (
    <div className="relative h-full overflow-hidden bg-call">
      <div ref={ref} className="absolute inset-0" />
      <div className="absolute inset-0 bg-call/45" />

      <div className="absolute left-4 top-4 rounded-pill bg-black/30 px-2.5 py-1 font-label text-[10px] font-semibold uppercase tracking-[0.13em] text-white/70">
        You
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white">
        <div className="relative grid place-items-center">
          <div className="seam-ring lc-anim-spin size-32 rounded-pill p-1" aria-hidden />
          <div className="absolute grid size-24 place-items-center rounded-pill bg-white/10">
            <Phone className="size-9" strokeWidth={1.6} />
          </div>
        </div>
        <div className="font-display text-3xl">Ringing the front desk…</div>
        <div className="font-mono text-sm text-white/70">Someone's almost there</div>
      </div>

      <CallControls
        muted={muted}
        cameraOff={cameraOff}
        onMute={onMute}
        onCamera={onCamera}
        primary={{ label: "Cancel", onClick: onCancel }}
      />
    </div>
  );
}
