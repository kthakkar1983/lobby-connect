import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  RING_WINDOW_MS,
  RECONNECT_WINDOW_MS,
  MAX_CALL_DURATION_MS,
  CHAT_PROTOCOL_VERSION,
  decodeChat,
  encodeChat,
  newMessageId,
  redactCardNumbers,
  typingExpired,
} from "@lc/shared";

import * as Sentry from "@sentry/react";
import { reduce, initialState, shouldFireRingTimeout, shouldEndForMaxDuration, isLockedOut } from "./state/call-machine";
import { fetchKioskConfig, startCall, endCall, fetchVideoToken, sendHeartbeat, fetchIncomingCall, answerCall } from "./lib/portal-api";
import { joinLiveKit } from "./lib/video/livekit";
import type { KioskVideoSession, VideoTrackHandle } from "./lib/video/types";
import { unlockAudioPlayback } from "./lib/audio-unlock";
import { useVisualViewportSize } from "./lib/use-visual-viewport-size";
import { interpretConnectionState } from "./lib/connection";
import type { KioskConfig } from "./types";
import { SeamShimmer } from "./components/brand";
import { copy } from "./lib/copy";
import { Home } from "./screens/Home";
import { IncomingCall } from "./screens/IncomingCall";
import { Ringing } from "./screens/Ringing";
import { Connected } from "./screens/Connected";
import { Apology } from "./screens/Apology";

const HEARTBEAT_MS = 30_000;
// Home-only discovery poll for an agent-initiated OUTBOUND call: an
// unauthenticated kiosk has no push channel to target, so it must discover its
// own ring (mirrors the agent-side incoming-video poll's role, reversed).
const DISCOVERY_POLL_MS = 3_000;

export function App() {
  // Pin the app to the visual viewport so the iPad keyboard shrinks the call
  // area instead of scrolling the video/chat off the top of the screen.
  useVisualViewportSize();

  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<VideoTrackHandle | null>(null);
  const [localVideo, setLocalVideo] = useState<VideoTrackHandle | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [chatLines, setChatLines] = useState<{ id: string; from: "guest" | "agent"; text: string; ts: number }[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Post-terminal-drop tap lockout (10s): set when a CONNECTED call's video
  // session drops terminally, so a returning guest can't re-tap and race the
  // agent's immediate call-back. null = not locked out.
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const sessionRef = useRef<KioskVideoSession | null>(null);
  const localAudioRef = useRef<MediaStreamTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cost backstop: caps a CONNECTED call's duration (armed on connect, cleared on
  // teardown) so an abandoned call can't hold the video room open.
  const maxCallTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every teardown to abort an in-flight call setup (see onStartCall).
  const callGenRef = useRef(0);
  // Timestamp (ms) of the last "typing start" received from the peer; the
  // watchdog effect below clears a stale indicator if "stop" never arrives.
  const lastPeerTypingRef = useRef(0);

  // Live mirror of the current screen for timer callbacks (avoids stale closures).
  const screenRef = useRef(state.screen);
  screenRef.current = state.screen;

  // Load config + start heartbeat interval.
  useEffect(() => {
    fetchKioskConfig().then(setConfig).catch(() => {});
    const id = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // Home-only incoming-call discovery poll (~3s): while idle, ask the portal
  // whether an agent has placed an OUTBOUND call to this property. Gated on
  // state.screen so it starts/stops as the kiosk enters/leaves Home — the
  // reducer's own INCOMING_CALL guard (home-only) would ignore a stray result
  // anyway, but tearing the interval down keeps a mid-call kiosk from polling
  // at all. `active` guards a poll that resolves after this effect's own
  // cleanup already ran (e.g. the screen changed mid-request).
  useEffect(() => {
    if (state.screen !== "home") return;
    let active = true;
    const poll = async () => {
      try {
        const call = await fetchIncomingCall();
        if (!active || !call) return;
        dispatch({ type: "INCOMING_CALL", callId: call.callId, channelName: call.channelName });
      } catch {
        // Best-effort discovery poll — a transient failure just waits for the next tick.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), DISCOVERY_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [state.screen]);

  // Typing watchdog: clears a stale "peer is typing" indicator if a "stop"
  // never arrives (e.g. the peer's tab backgrounds mid-type).
  useEffect(() => {
    const id = setInterval(() => {
      if (lastPeerTypingRef.current && typingExpired(lastPeerTypingRef.current, Date.now())) {
        lastPeerTypingRef.current = 0;
        setPeerTyping(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-clears the tap lockout without waiting for a user gesture: schedules
  // exactly the remaining time (not the full window), so a re-render mid-lockout
  // can't push the expiry back out.
  useEffect(() => {
    if (lockedUntil == null) return;
    const ms = Math.max(0, lockedUntil - Date.now());
    const t = setTimeout(() => setLockedUntil(null), ms);
    return () => clearTimeout(t);
  }, [lockedUntil]);

  const teardown = useCallback(async () => {
    // Invalidate any in-flight call setup: if the guest cancels during the async
    // startCall/join (many seconds on a cold first call), the setup must NOT go on
    // to join the room + arm the no-answer timer behind their back, which would leave
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
    // Chat has no separate provider on the kiosk (unlike the portal's
    // CallSurfaceProvider) — teardown is the per-call reset point.
    setChatLines([]);
    setPeerTyping(false);
    setChatOpen(false);
    lastPeerTypingRef.current = 0;
  }, []);

  // The LiveKit join callbacks are identical whichever direction started the
  // call (guest-dialed via onStartCall, or agent-dialed and answered via
  // onAnswer) — both just need a live room. Hoisted out of onStartCall so
  // onAnswer can reuse the EXACT same callback bodies instead of a parallel
  // copy; `aborted` is the one thing that's per-attempt (closes over that
  // call's own callGenRef generation), so it's threaded in as a parameter.
  const buildJoinCallbacks = useCallback((aborted: () => boolean) => ({
    onRemoteVideo: (h: VideoTrackHandle | null) => setRemoteVideo(h),
    onAgentJoined: () => {
      // Call connected — cancel the no-answer ring timer so it can't fire
      // mid-call and tear down a live session. (onAnswer never arms this
      // timer, so this is a harmless no-op on that path.)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      dispatch({ type: "AGENT_JOINED" });
      // Arm the max-duration cost cap. If the guest walks away mid-call, this
      // ends it (leave the room + close the row) instead of letting the room
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
        // SDK gave up. A drop from a LIVE (connected) call returns home with a
        // brief tap lockout so a re-tapping guest can't step on the agent's
        // immediate call-back; a pre-connect terminal failure (still ringing)
        // keeps the existing apology behavior.
        setReconnecting(false);
        const id = callIdRef.current;
        const wasConnected = screenRef.current === "connected";
        void teardown();
        if (id) void endCall(id, "failed");
        if (wasConnected) {
          setLockedUntil(Date.now() + RECONNECT_WINDOW_MS); // Home shows reconnecting + disabled tap; poll still runs
          dispatch({ type: "DROP" }); // -> home
        } else {
          dispatch({ type: "ERROR" }); // pre-connect failure -> apology (unchanged)
        }
      }
    },
    onData: (payload: Uint8Array, fromIdentity: string) => {
      if (aborted()) return; // ignore late packets after teardown (mirrors the portal's cancelled guard)
      const env = decodeChat(payload);
      if (!env) return;
      if (env.type === "msg") {
        const from = fromIdentity.startsWith("agent") ? "agent" : "guest";
        setChatLines((prev) => [...prev, { id: env.id, from, text: env.text, ts: env.ts }]);
        lastPeerTypingRef.current = 0;
        setPeerTyping(false);
        if (from === "agent") setChatOpen(true); // auto-open on the agent's message
      } else if (env.type === "typing") {
        const t = env.state === "start";
        lastPeerTypingRef.current = t ? Date.now() : 0;
        setPeerTyping(t);
      }
    },
  }), [teardown]);

  const onStartCall = useCallback(async () => {
    // A returning guest re-tapping during the post-drop lockout must not start
    // a fresh call and race the agent's immediate call-back.
    if (isLockedOut(lockedUntil, Date.now())) return;
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
      // Legacy wire param — the token route still validates uid; LiveKit ignores it.
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchVideoToken(channelName, uid);
      if (aborted()) { void endCall(callId, "cancelled"); return; }
      const callbacks = buildJoinCallbacks(aborted);
      const session = await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks });
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
      // Without this, a post-create setup failure (e.g. video token 500) leaves a
      // live, answerable RINGING row under the apology screen; answering it sticks
      // the call IN_PROGRESS and 0016-blocks the property for up to 30 min.
      const id = callIdRef.current;
      await teardown();
      if (id) void endCall(id, "failed");
      dispatch({ type: "ERROR" });
    }
  }, [teardown, buildJoinCallbacks, lockedUntil]);

  // The answer side of an agent-initiated OUTBOUND call: the reverse of
  // onStartCall (claim instead of create, join instead of dial). callId/
  // channelName are already known (INCOMING_CALL stored them from the discovery
  // poll). callIdRef is set synchronously up front so onCancel (wired to the
  // reused Ringing screen) can close THIS call if the guest backs out
  // mid-claim/join.
  const onAnswer = useCallback(async () => {
    unlockAudioPlayback();
    // Member access (not destructured from `state` as a whole) so the deps
    // array below can list the two primitive fields onAnswer actually reads,
    // matching exhaustive-deps rather than recreating on every screen change.
    const callId = state.callId;
    const channelName = state.channelName;
    if (!callId || !channelName) return; // defensive: reducer only reaches "incoming" with both set
    const gen = ++callGenRef.current; // this attempt's token; teardown() bumps it to abort
    const aborted = () => callGenRef.current !== gen;
    callIdRef.current = callId;
    // Dispatch ANSWER SYNCHRONOUSLY, before the first await — exactly as
    // onStartCall dispatches TAP_CALL before its own first await. This unmounts
    // the IncomingCall Answer button (incoming -> ringing) immediately, so a
    // second tap physically can't re-enter and start a competing generation.
    // WITHOUT this the button stays mounted for the whole answerCall round-trip:
    // a double-tap then makes tap#1 win the server claim (RINGING -> IN_PROGRESS,
    // agent already in the room) but bail on its now-stale aborted() check —
    // never joining — while tap#2 gets the 409 and returns home. Net: an
    // orphaned IN_PROGRESS call the kiosk never joined (the exact orphan class
    // the 0016 index + reaper + kiosk catch-leak fix exist to prevent).
    dispatch({ type: "ANSWER" });
    try {
      const claimed = await answerCall(callId);
      if (aborted()) return; // guest tapped Cancel on the reused Ringing screen mid-claim
      if (!claimed) {
        // Gone: the agent cancelled, the call timed out, or a lost race (409).
        // Nothing to close — it was never ours to end. Roll the optimistically
        // shown ringing screen back to home (a brief "connecting" flash on this
        // rare path is fine, mirroring onStartCall's dispatch-then-bail).
        dispatch({ type: "END_CALL" });
        return;
      }
      // Legacy wire param — the token route still validates uid; LiveKit ignores it.
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchVideoToken(claimed.channelName, uid);
      if (aborted()) return;
      const callbacks = buildJoinCallbacks(aborted);
      const session = await joinLiveKit({ url: tok.url, token: tok.token, ...callbacks });
      // Cancelled while joining? Leave the channel we just joined — onCancel
      // already closed the call server-side, so there's nothing left to do
      // here but not commit the session behind the guest's back.
      if (aborted()) {
        await session.leave();
        return;
      }
      sessionRef.current = session;
      localAudioRef.current = session.localAudioTrack;
      setLocalVideo(session.localVideo);
      // No CALL_STARTED, no ring timeout: the agent is already in the room —
      // buildJoinCallbacks' onAgentJoined fires off the existing video track
      // (joinLiveKit subscribes to tracks already published when it connects)
      // and drives ringing -> connected, same as the guest-dialed path.
    } catch {
      if (aborted()) return; // teardown already ran (cancel); don't override with apology
      const id = callIdRef.current;
      await teardown();
      if (id) void endCall(id, "failed");
      dispatch({ type: "ERROR" });
    }
  }, [state.callId, state.channelName, teardown, buildJoinCallbacks]);

  const onEnd = useCallback(async () => {
    // End locally first — leave the room + return home immediately — then notify the
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

  // PCI-critical: redactCardNumbers() runs BEFORE the text is ever encoded or
  // published, so a real card number can't reach the (self-hosted) LiveKit
  // data channel even transiently.
  const sendChat = useCallback((text: string) => {
    const clean = redactCardNumbers(text);
    const env = { v: CHAT_PROTOCOL_VERSION, type: "msg" as const, id: newMessageId(), text: clean, ts: Date.now() };
    sessionRef.current?.sendData(encodeChat(env), true);
    setChatLines((prev) => [...prev, { id: env.id, from: "guest", text: clean, ts: env.ts }]); // local echo
  }, []);
  const sendTyping = useCallback((s: "start" | "stop") => {
    sessionRef.current?.sendData(encodeChat({ v: CHAT_PROTOCOL_VERSION, type: "typing", state: s, ts: Date.now() }), false);
  }, []);

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
        return <Home config={config} onCall={onStartCall} lockedOut={isLockedOut(lockedUntil, Date.now())} />;
      case "incoming":
        return <IncomingCall onAnswer={onAnswer} />;
      case "ringing":
        return <Ringing localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onCancel={onCancel} />;
      case "connected":
        return <Connected remoteVideo={remoteVideo} localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onEnd={onEnd}
          chatOpen={chatOpen} chatLines={chatLines} peerTyping={peerTyping} onType={() => setChatOpen(true)} onSend={sendChat} onTyping={sendTyping} />;
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

/** Shown over the live call while the video SDK retries a dropped connection. */
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
