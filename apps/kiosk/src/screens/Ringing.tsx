import { useEffect, useRef } from "react";
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";

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
    <div style={{ position: "relative", height: "100%", background: "#27272a" }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 24, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 26 }}>
        Ringing the front desk…
      </div>
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        <CtrlButton label={muted ? "Unmute" : "Mute"} onClick={onMute} />
        <CtrlButton label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera} />
        <CtrlButton label="Cancel" danger onClick={onCancel} />
      </div>
    </div>
  );
}

function CtrlButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "14px 26px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 18, fontWeight: 600, background: danger ? "#b91c1c" : "rgba(255,255,255,0.9)", color: danger ? "#fff" : "#0f1f3d" }}>
      {label}
    </button>
  );
}
