import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

import { reduce, initialState, shouldFireRingTimeout } from "./state/call-machine";
import { fetchKioskConfig, startCall, endCall, fetchAgoraToken, sendHeartbeat } from "./lib/portal-api";
import { joinChannel, type KioskAgoraSession } from "./lib/agora";
import { interpretConnectionState } from "./lib/connection";
import type { KioskConfig } from "./types";
import { LogoMark, SeamShimmer } from "./components/brand";
import { copy } from "./lib/copy";
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

  // Live mirror of the current screen for timer callbacks (avoids stale closures).
  const screenRef = useRef(state.screen);
  screenRef.current = state.screen;

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
        onAgentJoined: () => {
          // Call connected — cancel the no-answer ring timer so it can't fire
          // mid-call and tear down a live session.
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          dispatch({ type: "AGENT_JOINED" });
        },
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
        // No-answer cutoff: only valid while still ringing. If the call has since
        // connected (and the clear above was somehow missed), stay inert rather
        // than tearing the live call down.
        if (!shouldFireRingTimeout(screenRef.current)) return;
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
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-5"
        role="status"
        aria-live="polite"
      >
        <LogoMark className="size-12" />
        <SeamShimmer />
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </div>
    );
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
        return <Apology message={config.apologyMessage} onDone={() => dispatch({ type: "DISMISS_APOLOGY" })} />;
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
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3.5 bg-call/[0.66] text-white"
      role="status"
      aria-live="polite"
    >
      <div className="seam-ring lc-anim-spin-fast size-14 rounded-pill p-[3px]" aria-hidden />
      <div className="text-lg font-semibold">{copy.reconnecting.title}</div>
      <div className="text-sm text-white/70">{copy.reconnecting.subtitle}</div>
    </div>
  );
}
