"use client";
// Phase-3 call-surface context (spec D1): the Softphone and the video host
// PUBLISH their incoming/active call state here; property cards, the call
// tile, and duty controls CONSUME it. The Twilio Device / video-call machinery
// stays inside its existing owners — this is state mirroring + dispatch,
// never a second call engine.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openCallTile, type CallTileHandle } from "@/lib/duty-tile/call-tile-manager";
import { CallTile } from "@/components/call-tile/call-tile";
import {
  fetchRemoteCredentials,
  launchRustdesk,
  type RemoteCredentials,
} from "@/lib/remote-access/connect";

export interface IncomingRing {
  key: string; // channel-prefixed for cross-channel uniqueness: "audio:<callId>" | "video:<calls.id>"
  channel: "AUDIO" | "VIDEO";
  callId: string | null;
  propertyId: string | null;
  propertyName: string;
  since: number; // client ms when the ring surfaced
}

export interface ActiveCallInfo {
  callId: string;
  channel: "AUDIO" | "VIDEO";
  propertyId: string | null;
  propertyName: string;
  onHold: boolean;
  answeredAt: number;
  /** Hotel-local timezone (audio: from the answered route) — the tile's clock face. */
  timeZone: string | null;
}

export interface ChatLine {
  id: string;
  from: "guest" | "agent";
  text: string;
  ts: number;
}
export interface ChatSnapshot {
  lines: ChatLine[];
  peerTyping: boolean;
}

export interface CallSurfaceSnapshot {
  rings: IncomingRing[];
  active: ActiveCallInfo | null;
}

export interface CallSurfaceActions {
  /** Accept the (single) ringing audio call. Registered by Softphone. */
  acceptAudio: (() => void) | null;
  /** Accept a ringing video call by calls.id. Registered by the video host. */
  acceptVideo: ((callId: string) => void) | null;
}

/**
 * Call controls the tile drives (Task 17). Registered by whichever component
 * owns the live call (Softphone for AUDIO, VideoCall for VIDEO) while a call is
 * in progress; cleared (null) on teardown. `triggerEmergency` is OPTIONAL — 911
 * is an audio-only mechanism (there is no video emergency path anywhere in the
 * codebase; see lib/emergency/, app/api/calls/[id]/emergency/*), so the video
 * registration simply omits it and the tile hides its 911 control when absent.
 * Do NOT invent a video 911 path here — this is a UI-composition seam only.
 */
export interface RegisteredCallControls {
  toggleMute: () => void;
  muted: boolean;
  hangUp: () => void;
  triggerEmergency?: () => void;
  /**
   * Send a chat message / typing signal. Registered ONLY by the VIDEO call
   * owner (video-call.tsx) — AUDIO calls have no chat, so the softphone omits
   * these (exactly as it omits triggerEmergency). The tile/overlay dispatch
   * through them.
   */
  sendChat?: (text: string) => void;
  sendTyping?: (state: "start" | "stop") => void;
}

/**
 * Registered by the video host once it's mounted and ready to originate a
 * call (Task 12, outbound video). `startOutboundVideo` invokes this AFTER the
 * backend route returns a callId/channelName, so the host can set its local
 * `active` state and mount `<VideoCall outbound channelName=...>`. The
 * registration itself lives in a plain ref (not state, unlike
 * acceptVideo/registerAcceptVideo) — nothing needs to reactively read "is a
 * starter registered"; it's only ever invoked imperatively, after the POST
 * resolves.
 */
export type OutboundStarter = (args: {
  callId: string;
  channelName: string;
  propertyId: string;
  propertyName: string;
}) => void;

interface CallSurfaceValue extends CallSurfaceSnapshot {
  actions: CallSurfaceActions;
  publishRings: (source: "audio" | "video", rings: IncomingRing[]) => void;
  /**
   * Publish/clear the active call FOR ONE CHANNEL. A non-null always takes the
   * slot; a null only clears the caller's own channel (an AUDIO publisher's
   * phase flap must never wipe a live VIDEO call's state — see the dispatcher).
   */
  publishActive: (channel: "AUDIO" | "VIDEO", active: ActiveCallInfo | null) => void;
  registerAcceptAudio: (fn: (() => void) | null) => void;
  registerAcceptVideo: (fn: ((callId: string) => void) | null) => void;
  /**
   * Originate an outbound VIDEO call to a property's kiosk — the reverse of
   * answering an inbound ring (agent-initiated outbound video calls). POSTs
   * /api/calls/start-outbound-video with `{propertyId}`; on success invokes
   * the registered OutboundStarter (the video host) so it mounts `<VideoCall>`
   * in outbound mode. Returns `{ok:false, busy:true}` on a 409 (the property
   * already has a live call, or the agent is already on one) and `{ok:false}`
   * on any other non-2xx response or network failure — the caller (a future
   * property-card "Kiosk" button) surfaces that to the agent. Deliberately a
   * single one-shot fetch, NOT reliableFetch's retry — like the 911 trigger,
   * this has a server-side side effect (creates the `calls` row + flips the
   * agent ON_CALL), so a blind retry risks a double-dial.
   */
  startOutboundVideo: (
    propertyId: string,
    propertyName: string,
  ) => Promise<{ ok: boolean; busy?: boolean }>;
  /** Register the video host's outbound-call starter (Task 12). Null clears it. */
  registerStartOutbound: (fn: OutboundStarter | null) => void;
  /**
   * Ring keys the LOCAL user has silenced (audio only). The publishers
   * (softphone audio ring / video-host ring) read this and mute their own
   * ringtone element for a silenced key; the card keeps ringing visually and
   * stays answerable. Silence is purely local — it never touches the server
   * call row or other users' rings.
   */
  silencedKeys: ReadonlySet<string>;
  /** Silence the local audio ringer for one ring key (idempotent). */
  silenceRing: (key: string) => void;
  /**
   * Call-scoped Document-PiP tile (spec §3.3). `tileMount` is the element
   * consumers portal into — null while no tile is open. `tileClosedByUser` is
   * true when the agent closed the tile mid-call (drives the Task-17 "Reopen
   * tile" affordance) and resets to false once the call ends or a new tile opens.
   */
  tileMount: HTMLElement | null;
  tileClosedByUser: boolean;
  /** Open the tile. Must be called synchronously inside the Answer click. */
  openTileForCall: () => void;
  /** Close the tile programmatically (e.g. on hang-up). No-op if none is open. */
  closeTile: () => void;
  /**
   * The guest's remote video track (LiveKit), shared so the tile can render its
   * own <video> face without a second subscription. Null when no video call is
   * live, or on an AUDIO call.
   */
  guestVideoTrack: MediaStreamTrack | null;
  publishGuestVideoTrack: (track: MediaStreamTrack | null) => void;
  /** The live call's controls, mirrored so the tile can drive mute/hang-up/911/notes. */
  callControls: RegisteredCallControls | null;
  registerCallControls: (controls: RegisteredCallControls | null) => void;
  /**
   * Fetch (or reuse the pre-warmed) RustDesk credentials for a property and
   * launch the native client. A cache HIT launches synchronously (before any
   * await) so the click's transient activation carries the rustdesk:// nav; a
   * miss / negative-cache entry always re-fetches (the negative cache never
   * blocks a click). Returns `{ launched }` and, on a failed launch, whether
   * the property simply has no remote access configured.
   */
  connectToProperty: (propertyId: string) => Promise<{ launched: boolean; notConfigured?: boolean }>;
  /**
   * Live-caption ENABLED state (spec D6/D7). Shared by the overlay toggle AND
   * the tile toggle. Default OFF, non-persistent, reset to false on every call
   * transition — captions bill per audio-minute, so they run only when the
   * agent deliberately turns them on, and never carry into the next call.
   */
  captionsEnabled: boolean;
  toggleCaptions: () => void;
  /**
   * Caption TEXT relay (spec D8). Kept OUT of the memoized value — per-partial
   * updates would re-render every consumer. The live-call owner publishes; the
   * tile's band reads via useSyncExternalStore, so only the band re-renders.
   */
  publishCaptions: (finals: string[], partial: string) => void;
  subscribeCaptions: (cb: () => void) => () => void;
  getCaptionSnapshot: () => { finals: string[]; partial: string };
  /**
   * Chat relay (in-call kiosk<->agent chat). Kept OUT of the memoized value like
   * captions — per-message updates would re-render every consumer. The live-call
   * owner appends inbound lines + peer-typing; the tile/overlay dock reads via
   * useSyncExternalStore, so only the dock re-renders.
   */
  appendChatLine: (line: ChatLine) => void;
  setPeerTyping: (typing: boolean) => void;
  subscribeChat: (cb: () => void) => () => void;
  getChatSnapshot: () => ChatSnapshot;
}

const CallSurfaceContext = createContext<CallSurfaceValue | null>(null);

export function CallSurfaceProvider({ children }: { children: React.ReactNode }) {
  const [audioRings, setAudioRings] = useState<IncomingRing[]>([]);
  const [videoRings, setVideoRings] = useState<IncomingRing[]>([]);
  const [active, setActive] = useState<ActiveCallInfo | null>(null);
  // Handlers live in state, not refs: a ref write doesn't trigger a re-render,
  // so the `value` memo below would keep returning a stale `actions` snapshot
  // from before a late Softphone/video-host registration. State makes the
  // dependency real (and keeps react-hooks/exhaustive-deps honest) instead of
  // needing a synthetic version-counter dependency to force a recompute.
  const [acceptAudioFn, setAcceptAudioFn] = useState<(() => void) | null>(null);
  const [acceptVideoFn, setAcceptVideoFn] = useState<((callId: string) => void) | null>(null);
  // Guest video track (LiveKit) — plain state, not a ref: the tile must re-render
  // when the track arrives/clears to (un)mount its <video> face.
  const [guestVideoTrack, setGuestVideoTrack] = useState<MediaStreamTrack | null>(null);
  // Call controls — held in STATE (not a ref) so the tile re-renders when they're
  // registered/cleared. Registration happens in effects on answer/teardown, not
  // per-render, so this doesn't churn.
  const [callControls, setCallControls] = useState<RegisteredCallControls | null>(null);
  // Ring keys the local user has silenced (audio only). Immutable updates keep
  // the Set's identity stable when nothing actually changes, so publisher
  // effects that read it don't churn.
  const [silencedKeys, setSilencedKeys] = useState<ReadonlySet<string>>(() => new Set());

  // Captions (spec D6–D8). Enabled is shared + default OFF + reset per call.
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const toggleCaptions = useCallback(() => setCaptionsEnabled((p) => !p), []);

  // Caption-text external store: refs + a listener set keep per-partial churn
  // off the memoized `value`. getCaptionSnapshot returns the ref's CURRENT
  // object (stable identity between publishes) so useSyncExternalStore is happy.
  const captionStoreRef = useRef<{ finals: string[]; partial: string }>({ finals: [], partial: "" });
  const captionListenersRef = useRef<Set<() => void>>(new Set());
  const publishCaptions = useCallback((finals: string[], partial: string) => {
    captionStoreRef.current = { finals, partial };
    for (const cb of captionListenersRef.current) cb();
  }, []);
  const subscribeCaptions = useCallback((cb: () => void) => {
    captionListenersRef.current.add(cb);
    return () => {
      captionListenersRef.current.delete(cb);
    };
  }, []);
  const getCaptionSnapshot = useCallback(() => captionStoreRef.current, []);

  // Chat external store — mirrors the caption relay: refs + a listener set keep
  // per-message churn off the memoized `value`, so only the chat dock re-renders.
  // Each mutation REPLACES the ref object (new identity) so useSyncExternalStore
  // sees a change; setPeerTyping no-ops when unchanged to keep identity stable.
  const chatStoreRef = useRef<ChatSnapshot>({ lines: [], peerTyping: false });
  const chatListenersRef = useRef<Set<() => void>>(new Set());
  // Inbound-chat chime element. It lives HERE in the MAIN window (see the JSX
  // below), NOT in the tile — the tile is a DocPiP whose document is autoplay-
  // locked until it gets its own gesture, so the tile-owned chime stayed silent
  // for the FIRST guest message (prod smoke 2026-07-14). The main document is
  // already unlocked by the agent's Answer click and plays even backgrounded,
  // exactly like the Twilio ring.
  const chatChimeRef = useRef<HTMLAudioElement>(null);
  const appendChatLine = useCallback((line: ChatLine) => {
    const prev = chatStoreRef.current;
    chatStoreRef.current = { lines: [...prev.lines, line], peerTyping: prev.peerTyping };
    for (const cb of chatListenersRef.current) cb();
    // Chime on every genuinely-inbound guest line (never the agent's own echo).
    // appendChatLine is called once per received message, so no seed/dedup is
    // needed here; the tile keeps ONLY the unread-badge, gated to its video face.
    if (line.from === "guest") {
      const el = chatChimeRef.current;
      if (el) {
        el.currentTime = 0;
        const p = el.play();
        if (p) void p.catch(() => {}); // guard: jsdom's play() returns undefined
      }
    }
  }, []);
  const setPeerTyping = useCallback((typing: boolean) => {
    const prev = chatStoreRef.current;
    if (prev.peerTyping === typing) return; // no churn when unchanged
    chatStoreRef.current = { lines: prev.lines, peerTyping: typing };
    for (const cb of chatListenersRef.current) cb();
  }, []);
  const subscribeChat = useCallback((cb: () => void) => {
    chatListenersRef.current.add(cb);
    return () => {
      chatListenersRef.current.delete(cb);
    };
  }, []);
  const getChatSnapshot = useCallback(() => chatStoreRef.current, []);

  // Call-scoped Document-PiP tile. The handle (window/close fn) is a REF — it's
  // an imperative object, not render-relevant; only the mount element and the
  // reopen-affordance boolean are state (consumers must re-render on them).
  const [tileMount, setTileMount] = useState<HTMLElement | null>(null);
  const [tileClosedByUser, setTileClosedByUser] = useState(false);
  const tileHandleRef = useRef<CallTileHandle | null>(null);
  // pagehide fires on BOTH user-close and our own programmatic close() — this
  // ref disambiguates so a hang-up-driven close never flips the reopen flag.
  const programmaticCloseRef = useRef(false);
  // Mirrors `active` for the onClosed callback, which must stay []-stable (no
  // `active` in its deps) yet still needs to know if a call is still live.
  const activeRef = useRef<ActiveCallInfo | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Pre-warmed RustDesk credentials for the CURRENT call's property (spec §3.5).
  // Refs only — NEVER context state: writing the cache into the memoized `value`
  // would churn it every fetch and loop the whole tree. The map holds ONLY the
  // current call's property — it's cleared on EVERY callId transition (call end
  // OR a direct call-B-overwrites-call-A change), so a Connect during call B can
  // never hit call A's stale creds and skip the issuance audit. `prewarmedCallIdRef`
  // dedups the softphone's mid-call ActiveCallInfo republish (it re-publishes when
  // callTimeZone arrives) and React StrictMode's double-invoke, so we fetch/audit
  // exactly once per call.
  const prewarmRef = useRef<Map<string, RemoteCredentials | "not-configured">>(new Map());
  const prewarmedCallIdRef = useRef<string | null>(null);

  const publishRings = useCallback((source: "audio" | "video", rings: IncomingRing[]) => {
    (source === "audio" ? setAudioRings : setVideoRings)(rings);
  }, []);
  // Two components write this one slot — the audio softphone and the video
  // host — and each may only CLEAR what it owns: publishing a call always takes
  // the slot, but a null from channel X is ignored while channel Y's call holds
  // it. Root cause this encodes (2026-07-07 staging): closing the tile focuses
  // the tab → the softphone's error-phase reconnect self-heal flapped `phase` →
  // its publisher re-ran and published an AUDIO null mid-VIDEO-call → the slot
  // cleared → the auto-close effect wiped the just-set reopen flag. Functional
  // update = atomic (no read-then-write race between the two publishers).
  const publishActive = useCallback(
    (channel: "AUDIO" | "VIDEO", a: ActiveCallInfo | null) => {
      setActive((prev) => {
        if (a) return a;
        if (prev && prev.channel !== channel) return prev; // not yours to clear
        return null;
      });
    },
    [],
  );
  const registerAcceptAudio = useCallback((fn: (() => void) | null) => {
    // Functional updates can't hold a plain function value (React would call
    // it as an updater), so wrap it in an updater that returns the function.
    setAcceptAudioFn(() => fn);
  }, []);
  const registerAcceptVideo = useCallback((fn: ((callId: string) => void) | null) => {
    setAcceptVideoFn(() => fn);
  }, []);
  const publishGuestVideoTrack = useCallback((track: MediaStreamTrack | null) => {
    setGuestVideoTrack(track);
  }, []);
  // No functional-update wrap needed here (unlike registerAcceptAudio/Video):
  // RegisteredCallControls is always an object or null, never a bare function,
  // so React can't misinterpret it as a state updater.
  const registerCallControls = useCallback((controls: RegisteredCallControls | null) => {
    setCallControls(controls);
  }, []);

  // Identity-stable dispatcher: silence one ring key. Returns the same Set when
  // the key is already present so a double-silence doesn't churn identity.
  const silenceRing = useCallback((key: string) => {
    setSilencedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // Close the tile programmatically — sets the flag BEFORE calling close() so
  // the pagehide it triggers is recognized as ours, not a user close.
  const closeTile = useCallback(() => {
    const handle = tileHandleRef.current;
    if (!handle) return;
    programmaticCloseRef.current = true;
    handle.close();
  }, []);

  // Open the tile for the active call. Synchronous entry point for the gesture
  // — openCallTile() calls requestWindow() before returning, satisfying the
  // "must run inside the click, before any await" constraint.
  const openTileForCall = useCallback(() => {
    if (tileHandleRef.current) return; // already open — no-op
    openCallTile(
      (handle) => {
        tileHandleRef.current = handle;
        setTileMount(handle.mount);
        setTileClosedByUser(false);
      },
      () => {
        const wasProgrammatic = programmaticCloseRef.current;
        programmaticCloseRef.current = false;
        tileHandleRef.current = null;
        setTileMount(null);
        if (!wasProgrammatic && activeRef.current) {
          setTileClosedByUser(true);
        }
      },
    );
  }, []);

  // Pre-warm the current call's remote-access credentials at Answer (spec §3.5).
  // DEP-HYGIENE: depend on the PRIMITIVES (active?.callId + active?.propertyId),
  // NEVER the `active` object — the softphone republishes a fresh ActiveCallInfo
  // mid-call once callTimeZone arrives, so object-keying would re-run the effect
  // and double-fetch AND double-audit every audio call. prewarmedCallIdRef gates
  // out that republish + StrictMode's double-invoke.
  useEffect(() => {
    if (active?.callId == null) {
      // Call ended (or none): clear the cache for the next call.
      prewarmRef.current.clear();
      prewarmedCallIdRef.current = null;
      return;
    }
    if (active.callId === prewarmedCallIdRef.current) return; // republish / StrictMode dedup — keep current creds
    // A genuinely new call (callId changed): drop any prior property's creds so
    // a Connect during THIS call can only ever serve — or audit-miss on — the
    // current property. Runs AFTER the same-callId early-return, so a republish
    // never clears the current call's pre-warmed creds.
    prewarmRef.current.clear();
    prewarmedCallIdRef.current = active.callId;
    if (active.propertyId == null) return; // nothing to key on
    const callId = active.callId;
    const propertyId = active.propertyId;
    void fetchRemoteCredentials(propertyId, "prewarm").then((r) => {
      // Stale-response guard: bail if this is no longer the pre-warmed call.
      if (prewarmedCallIdRef.current !== callId) return;
      if (r.ok) prewarmRef.current.set(propertyId, r.creds);
      else if (r.notConfigured) prewarmRef.current.set(propertyId, "not-configured");
      // A transient failure writes NOTHING — the next Connect click re-fetches.
    });
  }, [active?.callId, active?.propertyId]);

  // Connect to a property's hotel PC. []-stable (reads refs only, which are
  // stable). A cache HIT launches synchronously before any await so the click's
  // transient activation carries the rustdesk:// navigation; a miss (or the
  // negative "not-configured" entry) always re-fetches via the click path —
  // click never trusts the negative cache. Click-fetched creds are NOT written
  // back into prewarmRef (no long-lived plaintext parked in tab memory).
  const connectToProperty = useCallback(
    async (propertyId: string): Promise<{ launched: boolean; notConfigured?: boolean }> => {
      // The tile follows her into RustDesk (2026-07-11): if a call is live and the
      // tile was closed ("Back to tab"), reopen it in THIS click — DocPiP needs the
      // gesture — BEFORE launching RustDesk, so her call surface isn't stranded in
      // the now-backgrounded tab. openTileForCall no-ops if the tile is already
      // open or DocPiP is unsupported. It runs FIRST because requestWindow strictly
      // requires the fresh activation, whereas the rustdesk:// launch tolerates a
      // spent one (the cache-miss path below already launches after an await).
      if (activeRef.current) openTileForCall();
      const hit = prewarmRef.current.get(propertyId);
      if (hit && hit !== "not-configured") {
        launchRustdesk(hit); // synchronous — preserves the click's activation
        return { launched: true };
      }
      const r = await fetchRemoteCredentials(propertyId, "click");
      if (r.ok) {
        launchRustdesk(r.creds);
        return { launched: true };
      }
      return { launched: false, notConfigured: r.notConfigured };
    },
    [openTileForCall],
  );

  // Outbound-call origination (Task 12). startOutboundRef is a plain ref (not
  // state, unlike acceptVideoFn): nothing reactively reads "has the host
  // registered a starter" — it's only ever invoked imperatively below, after
  // the POST resolves, mirroring connectToProperty's ref-only internals.
  const startOutboundRef = useRef<OutboundStarter | null>(null);
  const registerStartOutbound = useCallback((fn: OutboundStarter | null) => {
    startOutboundRef.current = fn;
  }, []);
  const startOutboundVideo = useCallback(
    async (propertyId: string, propertyName: string): Promise<{ ok: boolean; busy?: boolean }> => {
      const res = await fetch("/api/calls/start-outbound-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }).catch(() => null);
      if (res && res.status === 409) return { ok: false, busy: true };
      if (!res || !res.ok) return { ok: false };
      const { callId, channelName } = (await res.json()) as { callId: string; channelName: string };
      startOutboundRef.current?.({ callId, channelName, propertyId, propertyName });
      return { ok: true };
    },
    [],
  );

  // Auto-reset + no unbounded growth: whenever the set of currently-ringing keys
  // changes, drop any silenced key that is no longer ringing. A brand-new call
  // gets a new key that isn't silenced, so it rings again. ringKeys is memoized
  // so it doesn't get a fresh identity every render (which would loop the effect).
  const ringKeys = useMemo(
    () => new Set([...audioRings, ...videoRings].map((r) => r.key)),
    [audioRings, videoRings],
  );
  useEffect(() => {
    setSilencedKeys((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (ringKeys.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev; // keep identity stable when nothing pruned
    });
  }, [ringKeys]);

  // Per-call caption reset (spec D7): a new callId — or call end (null) — turns
  // captions OFF and clears the relay. A forgotten "on" never bills the next call.
  useEffect(() => {
    setCaptionsEnabled(false);
    captionStoreRef.current = { finals: [], partial: "" };
    for (const cb of captionListenersRef.current) cb();
    chatStoreRef.current = { lines: [], peerTyping: false };
    for (const cb of chatListenersRef.current) cb();
  }, [active?.callId]);

  // Auto-close: when the call ends (active → null), any open tile closes with
  // it and the reopen affordance resets — the call is over, there's nothing
  // left to reopen into. closeTile is []-stable, so this effect only reruns
  // on real `active` transitions, not on every render.
  useEffect(() => {
    if (active === null) {
      closeTile();
      setTileClosedByUser(false);
    }
  }, [active, closeTile]);

  const value = useMemo<CallSurfaceValue>(
    () => ({
      rings: [...audioRings, ...videoRings],
      active,
      actions: { acceptAudio: acceptAudioFn, acceptVideo: acceptVideoFn },
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
      startOutboundVideo,
      registerStartOutbound,
      silencedKeys,
      silenceRing,
      tileMount,
      tileClosedByUser,
      openTileForCall,
      closeTile,
      guestVideoTrack,
      publishGuestVideoTrack,
      callControls,
      registerCallControls,
      connectToProperty,
      captionsEnabled,
      toggleCaptions,
      publishCaptions,
      subscribeCaptions,
      getCaptionSnapshot,
      appendChatLine,
      setPeerTyping,
      subscribeChat,
      getChatSnapshot,
    }),
    [
      audioRings,
      videoRings,
      active,
      acceptAudioFn,
      acceptVideoFn,
      publishRings,
      publishActive,
      registerAcceptAudio,
      registerAcceptVideo,
      startOutboundVideo,
      registerStartOutbound,
      silencedKeys,
      silenceRing,
      tileMount,
      tileClosedByUser,
      openTileForCall,
      closeTile,
      guestVideoTrack,
      publishGuestVideoTrack,
      callControls,
      registerCallControls,
      connectToProperty,
      captionsEnabled,
      toggleCaptions,
      publishCaptions,
      subscribeCaptions,
      getCaptionSnapshot,
      appendChatLine,
      setPeerTyping,
      subscribeChat,
      getChatSnapshot,
    ],
  );

  return (
    <CallSurfaceContext.Provider value={value}>
      {children}
      {/* Inbound-chat chime — MAIN window (autoplay-unlocked), played imperatively
          from appendChatLine so the first guest message is audible even before
          the agent has touched the DocPiP tile. */}
      <audio ref={chatChimeRef} src="/sounds/chat-message.mp3" preload="auto" className="hidden" aria-hidden />
      {tileMount ? createPortal(<CallTile />, tileMount) : null}
    </CallSurfaceContext.Provider>
  );
}

export function useCallSurface(): CallSurfaceValue {
  const ctx = useContext(CallSurfaceContext);
  if (!ctx) throw new Error("useCallSurface must be used inside CallSurfaceProvider");
  return ctx;
}

/** Safe variant for components that may render outside the shell (returns null). */
export function useCallSurfaceOptional(): CallSurfaceValue | null {
  return useContext(CallSurfaceContext);
}
