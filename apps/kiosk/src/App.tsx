import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

import { reduce, initialState } from "./state/call-machine";
import { fetchKioskConfig, startCall, endCall, fetchAgoraToken, sendHeartbeat } from "./lib/portal-api";
import { joinChannel, type KioskAgoraSession } from "./lib/agora";
import { interpretConnectionState } from "./lib/connection";
import type { KioskConfig } from "./types";
import { Home } from "./screens/Home";
import { RecordingNotice } from "./screens/RecordingNotice";
import { Ringing } from "./screens/Ringing";
import { Connected } from "./screens/Connected";
import { Apology } from "./screens/Apology";

const RING_TIMEOUT_MS = 120_000;
const HEARTBEAT_MS = 30_000;

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null);
  const [localVideo, setLocalVideo] = useState<ICameraVideoTrack | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<KioskAgoraSession | null>(null);
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config + start heartbeat interval.
  useEffect(() => {
    fetchKioskConfig().then(setConfig).catch(() => {});
    const id = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  const teardown = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await sessionRef.current?.leave();
    sessionRef.current = null;
    localAudioRef.current = null;
    setRemoteVideo(null);
    setLocalVideo(null);
    setMuted(false);
    setCameraOff(false);
    setReconnecting(false);
  }, []);

  const onAccept = useCallback(async () => {
    try {
      const { callId, channelName } = await startCall();
      callIdRef.current = callId;
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchAgoraToken(channelName, uid);
      const session = await joinChannel({
        appId: tok.appId, channel: tok.channelName, token: tok.token, uid: tok.uid,
        onRemoteVideo: (t) => setRemoteVideo(t ?? null),
        onAgentJoined: () => dispatch({ type: "AGENT_JOINED" }),
        onAgentLeft: () => {
          void teardown();
          void endCall(callIdRef.current!, "completed");
          dispatch({ type: "END_CALL" });
        },
        onConnectionStateChange: (cur, _prev, reason) => {
          const outcome = interpretConnectionState(cur, reason);
          if (outcome === "lost") {
            // SDK is retrying — show the overlay, don't tear down yet.
            setReconnecting(true);
          } else if (outcome === "restored") {
            setReconnecting(false);
          } else if (outcome === "terminal") {
            // SDK gave up. Close the call and fall through to the apology screen.
            setReconnecting(false);
            const id = callIdRef.current;
            void teardown();
            if (id) void endCall(id, "failed");
            dispatch({ type: "ERROR" });
          }
        },
      });
      sessionRef.current = session;
      localAudioRef.current = session.localAudio;
      setLocalVideo(session.localVideo);
      dispatch({ type: "ACCEPT_DISCLOSURE", callId, channelName });
      timeoutRef.current = setTimeout(() => {
        if (callIdRef.current) void endCall(callIdRef.current, "no-answer");
        void teardown();
        dispatch({ type: "RING_TIMEOUT" });
      }, RING_TIMEOUT_MS);
    } catch {
      await teardown();
      dispatch({ type: "ERROR" });
    }
  }, [teardown]);

  const onEnd = useCallback(async () => {
    if (callIdRef.current) await endCall(callIdRef.current, "completed");
    await teardown();
    dispatch({ type: "END_CALL" });
  }, [teardown]);

  const onCancel = useCallback(async () => {
    if (callIdRef.current) await endCall(callIdRef.current, "cancelled");
    await teardown();
    dispatch({ type: "CANCEL" });
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    const t = localAudioRef.current?.getMediaStreamTrack();
    if (t) t.enabled = !next;
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOff;
    const t = localVideo?.getMediaStreamTrack();
    if (t) t.enabled = !next;
    setCameraOff(next);
  }, [cameraOff, localVideo]);

  if (!config) {
    return <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>Loading…</div>;
  }

  const screen = (() => {
    switch (state.screen) {
      case "home":
        return <Home config={config} onCall={() => dispatch({ type: "TAP_CALL" })} />;
      case "disclosure":
        return <RecordingNotice onOk={onAccept} onClose={() => dispatch({ type: "CLOSE_DISCLOSURE" })} />;
      case "ringing":
        return <Ringing localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onCancel={onCancel} />;
      case "connected":
        return <Connected remoteVideo={remoteVideo} localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onEnd={onEnd} />;
      case "apology":
        return <Apology message={config.apologyMessage} phone={config.phoneNumber} onDone={() => dispatch({ type: "DISMISS_APOLOGY" })} />;
    }
  })();

  return (
    <>
      {screen}
      {reconnecting && <ReconnectingOverlay />}
    </>
  );
}

/** Shown over the live call while the Agora SDK retries a dropped connection. */
function ReconnectingOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        fontSize: 24,
        zIndex: 50,
      }}
    >
      Reconnecting…
    </div>
  );
}
