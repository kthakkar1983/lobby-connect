import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { RING_WINDOW_MS, MAX_CALL_DURATION_MS } from "@lc/shared";

import * as Sentry from "@sentry/react";
import { reduce, initialState, shouldFireRingTimeout, shouldEndForMaxDuration } from "./state/call-machine";
import { fetchKioskConfig, startCall, endCall, fetchVideoToken, sendHeartbeat } from "./lib/portal-api";
import { joinAgora } from "./lib/video/agora";
import { joinLiveKit } from "./lib/video/livekit";
import type { KioskVideoSession, VideoTrackHandle } from "./lib/video/types";
import { unlockAudioPlayback } from "./lib/audio-unlock";
import { interpretConnectionState } from "./lib/connection";
import type { KioskConfig } from "./types";
import { SeamShimmer } from "./components/brand";
import { copy } from "./lib/copy";
import { Home } from "./screens/Home";
import { Ringing } from "./screens/Ringing";
import { Connected } from "./screens/Connected";
import { Apology } from "./screens/Apology";

const HEARTBEAT_MS = 30_000;

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<VideoTrackHandle | null>(null);
  const [localVideo, setLocalVideo] = useState<VideoTrackHandle | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const sessionRef = useRef<KioskVideoSession | null>(null);
  const localAudioRef = useRef<MediaStreamTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cost backstop: caps a CONNECTED call's duration (armed on connect, cleared on
  // teardown) so an abandoned call can't hold the Agora channel + billing open.
  const maxCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every teardown to abort an in-flight call setup (see onStartCall).
  const callGenRef = useRef(0);

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
    // Invalidate any in-flight call setup: if the guest cancels during the async
    // startCall/join (many seconds on a cold first call), the setup must NOT go on
    // to join Agora + arm the no-answer timer behind their back, which would leave
    // an uncancellable call ringing for the full window.
    callGenRef.current += 1;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (maxCallTimeoutRef.current) clearTimeout(maxCallTimeoutRef.current);
    await sessionRef.current?.leave();
    sessionRef.current = null;
    localAudioRef.current = null;
    setRemoteVideo(null);
    setLocalVideo(null);
    setMuted(false);
    setCameraOff(false);
    setReconnecting(false);
  }, []);

  const onStartCall = useCallback(async () => {
    // Unlock audio output on this tap so the agent's audio plays even after the
    // cold join chain (keeps the guest screen prompt-free).
    unlockAudioPlayback();
    callIdRef.current = null; // clear any prior call's id while the new one sets up
    const gen = ++callGenRef.current; // this attempt's token; teardown() bumps it to abort
    const aborted = () => callGenRef.current !== gen;
    dispatch({ type: "TAP_CALL" }); // → ringing immediately (connecting); async setup follows
    try {
      const { callId, channelName } = await startCall();
      // Cancelled during the (cold-slow) startCall? Close the row we just created.
      if (aborted()) { void endCall(callId, "cancelled"); return; }
      callIdRef.current = callId;
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchVideoToken(channelName, uid);
      if (aborted()) { void endCall(callId, "cancelled"); return; }
      const callbacks = {
        onRemoteVideo: (h: VideoTrackHandle | null) => setRemoteVideo(h),
        onAgentJoined: () => {
          // Call connected — cancel the no-answer ring timer so it can't fire
          // mid-call and tear down a live session.
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          dispatch({ type: "AGENT_JOINED" });
          // Arm the max-duration cost cap. If the guest walks away mid-call, this
          // ends it (leave Agora + close the row) instead of letting the channel
          // bill on to the 1h token expiry. The guard keeps a late fire inert.
          maxCallTimeoutRef.current = setTimeout(() => {
            if (!shouldEndForMaxDuration(screenRef.current)) return;
            Sentry.captureMessage("kiosk call hit max-duration cap; ending", { level: "warning" });
            if (callIdRef.current) void endCall(callIdRef.current, "completed");
            void teardown();
            dispatch({ type: "END_CALL" });
          }, MAX_CALL_DURATION_MS);
        },
        onAgentLeft: () => {
          void teardown();
          void endCall(callIdRef.current!, "completed");
          dispatch({ type: "END_CALL" });
        },
        onConnectionStateChange: (cur: string, _prev: string, reason?: string) => {
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
      };
      const session =
        tok.provider === "livekit"
          ? await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks })
          : await joinAgora({ appId: tok.appId, channel: tok.channelName, token: tok.token, uid: tok.uid, ...callbacks });
      // Cancelled while joining? Leave the channel we just joined and close the
      // call instead of committing to it behind the guest's back.
      if (aborted()) {
        await session.leave();
        void endCall(callId, "cancelled");
        return;
      }
      sessionRef.current = session;
      localAudioRef.current = session.localAudioTrack;
      setLocalVideo(session.localVideo);
      dispatch({ type: "CALL_STARTED", callId, channelName });
      timeoutRef.current = setTimeout(() => {
        // No-answer cutoff: only valid while still ringing. If the call has since
        // connected (and the clear above was somehow missed), stay inert rather
        // than tearing the live call down.
        if (!shouldFireRingTimeout(screenRef.current)) return;
        if (callIdRef.current) void endCall(callIdRef.current, "no-answer");
        void teardown();
        dispatch({ type: "RING_TIMEOUT" });
      }, RING_WINDOW_MS);
    } catch {
      if (aborted()) return; // teardown already ran (cancel); don't override with apology
      // Close the row we already created (callIdRef is set once startCall resolved).
      // Without this, a post-create setup failure (e.g. Agora token 500) leaves a
      // live, answerable RINGING row under the apology screen; answering it sticks
      // the call IN_PROGRESS and 0016-blocks the property for up to 30 min.
      const id = callIdRef.current;
      await teardown();
      if (id) void endCall(id, "failed");
      dispatch({ type: "ERROR" });
    }
  }, [teardown]);

  const onEnd = useCallback(async () => {
    // End locally first — leave Agora + return home immediately — then notify the
    // server in the background. The server round-trip must never gate the button:
    // a slow/cold call-ended route was leaving End apparently unresponsive.
    const id = callIdRef.current;
    await teardown();
    dispatch({ type: "END_CALL" });
    if (id) void endCall(id, "completed");
  }, [teardown]);

  const onCancel = useCallback(async () => {
    const id = callIdRef.current;
    await teardown();
    dispatch({ type: "CANCEL" });
    if (id) void endCall(id, "cancelled");
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    const t = localAudioRef.current;
    if (t) t.enabled = !next;
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOff;
    const t = localVideo?.mediaStreamTrack();
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
        <SeamShimmer />
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </div>
    );
  }

  const screen = (() => {
    switch (state.screen) {
      case "home":
        return <Home config={config} onCall={onStartCall} />;
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
