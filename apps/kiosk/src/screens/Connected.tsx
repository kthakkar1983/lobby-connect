import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

export function Connected({
  remoteVideo, localVideo, muted, cameraOff, onMute, onCamera, onEnd,
}: {
  remoteVideo: IRemoteVideoTrack | null;
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
}) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (remoteVideo && remoteRef.current) remoteVideo.play(remoteRef.current); }, [remoteVideo]);
  useEffect(() => { if (localVideo && localRef.current) localVideo.play(localRef.current); }, [localVideo]);

  return (
    <div style={{ position: "relative", height: "100%", background: "#000" }}>
      <div ref={remoteRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={localRef} style={{ position: "absolute", bottom: 100, right: 24, width: 200, height: 140, borderRadius: 12, overflow: "hidden", border: "2px solid rgba(255,255,255,0.5)" }} />
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        <button type="button" onClick={onMute} style={ctrl(false)}>{muted ? "Unmute" : "Mute"}</button>
        <button type="button" onClick={onCamera} style={ctrl(false)}>{cameraOff ? "Camera on" : "Camera off"}</button>
        <button type="button" onClick={onEnd} style={ctrl(true)}>End Call</button>
      </div>
    </div>
  );
}

function ctrl(danger: boolean): CSSProperties {
  return { padding: "14px 26px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 18, fontWeight: 600, background: danger ? "#b91c1c" : "rgba(255,255,255,0.9)", color: danger ? "#fff" : "#0f1f3d" };
}
