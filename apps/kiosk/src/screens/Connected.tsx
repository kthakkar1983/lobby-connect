import { useEffect, useRef, useState } from "react";
import type { VideoTrackHandle } from "../lib/video/types";
import { CallControls } from "./CallControls";

function useElapsed(): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function Connected({
  remoteVideo, localVideo, muted, cameraOff, onMute, onCamera, onEnd,
}: {
  remoteVideo: VideoTrackHandle | null;
  localVideo: VideoTrackHandle | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
}) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed();
  useEffect(() => { if (remoteVideo && remoteRef.current) remoteVideo.attach(remoteRef.current); }, [remoteVideo]);
  useEffect(() => { if (localVideo && localRef.current) localVideo.attach(localRef.current); }, [localVideo]);

  return (
    <div className="relative h-full overflow-hidden bg-call">
      <div ref={remoteRef} className="absolute inset-0" />
      <div className="seam-ring lc-seam-drift pointer-events-none absolute inset-0 p-[2px]" aria-hidden />

      <div className="absolute left-4 top-4 flex items-center gap-2.5 rounded-pill border border-white/10 bg-call/60 py-1.5 pl-2.5 pr-3.5">
        <span className="lc-anim-pulse size-2.5 rounded-pill bg-live" aria-hidden />
        <span className="text-sm font-semibold leading-tight text-white">
          Connected
          <span className="block font-mono text-[10px] font-medium text-white/65">
            Front desk · {elapsed}
          </span>
        </span>
      </div>

      <div className="absolute right-5 top-5 z-10 h-[104px] w-[152px] overflow-hidden rounded-card border-2 border-white/45">
        <div ref={localRef} className="absolute inset-0" />
        <span className="absolute bottom-1.5 left-2 font-label text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
          You
        </span>
      </div>

      <CallControls
        muted={muted}
        cameraOff={cameraOff}
        onMute={onMute}
        onCamera={onCamera}
        primary={{ label: "End", onClick: onEnd }}
      />
    </div>
  );
}
