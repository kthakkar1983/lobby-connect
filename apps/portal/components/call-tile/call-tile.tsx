"use client";
// Call-scoped Document-PiP tile face (spec §3.3, Task 17). Renders INSIDE the
// PiP window (portaled by CallSurfaceProvider) and is purely a MIRROR of the
// live call surface — it owns no call/Twilio/LiveKit/911 state of its own.
// Every control here dispatches through `callControls`, registered by whichever
// component owns the live call (Softphone for AUDIO, VideoCall for VIDEO).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, PhoneOff, AlertTriangle, Monitor, Clock } from "lucide-react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";
import { ChatDock } from "@/components/call/chat-dock";

// How long the armed "Confirm 911" state stays live before auto-reverting.
const EMERGENCY_ARM_WINDOW_MS = 5_000;

// Stable module-level fallbacks so useSyncExternalStore is called
// unconditionally (never behind an optional-chain) and never re-subscribes on a
// fresh identity each render.
const EMPTY_CAPTIONS = { finals: [] as string[], partial: "" };
const NOOP_SUBSCRIBE = () => () => {};
const GET_EMPTY_CAPTIONS = () => EMPTY_CAPTIONS;
const EMPTY_CHAT = {
  lines: [] as { id: string; from: "guest" | "agent"; text: string; ts: number }[],
  peerTyping: false,
};
const GET_EMPTY_CHAT = () => EMPTY_CHAT;

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Guest video face — attaches the shared remote track to a local <video> el.
 *  Muted: call audio keeps playing from the main tab, never doubled here. */
function GuestVideo({ track }: { track: MediaStreamTrack }): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([track]);
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      className="h-full w-full rounded-md object-cover"
    />
  );
}

/** Self-ticking hotel-local-time clock, mirroring AudioCallOverlay's pattern. */
function useHotelClock(timeZone: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const fmt = useMemo(() => {
    if (!timeZone) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [timeZone]);
  return fmt ? fmt.format(new Date(now)) : null;
}

/** Self-ticking elapsed-time readout from a client-ms answeredAt stamp. */
function useElapsed(answeredAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - answeredAt) / 1_000));
}

export function CallTile(): React.JSX.Element | null {
  const surface = useCallSurfaceOptional();
  const active = surface?.active ?? null;
  const guestVideoTrack = surface?.guestVideoTrack ?? null;
  const controls = surface?.callControls ?? null;

  // 911 two-tap arm/confirm — local UI state only; the actual trigger is the
  // registered controls.triggerEmergency (audio's real POST). Auto-reverts
  // after EMERGENCY_ARM_WINDOW_MS so an accidental first tap doesn't stay armed.
  const [armed, setArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    // A new call (or the call ending) must not carry a stale armed state, chat
    // mode, or chat-unread badge into the next one.
    setArmed(false);
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setChatMode("video");
    setChatUnread(false);
    lastChatIdRef.current = undefined;
  }, [active?.callId]);

  // Captions mirror the surface (spec D6–D8): shared enabled flag (default OFF,
  // reset per call) + the external caption-text store. The band only shows when
  // captions are ON and there's text.
  const captionsEnabled = surface?.captionsEnabled ?? false;
  const toggleCaptions = surface?.toggleCaptions ?? (() => {});
  const caption = useSyncExternalStore(
    surface?.subscribeCaptions ?? NOOP_SUBSCRIBE,
    surface?.getCaptionSnapshot ?? GET_EMPTY_CAPTIONS,
  );

  // Chat mirrors the surface the same way captions do (Task 9): an external
  // store of lines/peerTyping, plus tile-LOCAL UI state for which face is
  // showing and whether an unseen guest line has arrived. Chat is video-only —
  // the toggle/face below are gated on controls.sendChat, registered only by
  // the video call owner.
  const chat = useSyncExternalStore(
    surface?.subscribeChat ?? NOOP_SUBSCRIBE,
    surface?.getChatSnapshot ?? GET_EMPTY_CHAT,
  );
  const [chatMode, setChatMode] = useState<"video" | "chat">("video");
  const [chatUnread, setChatUnread] = useState(false);
  // Seed sentinel: undefined = not yet initialised (so lines already present
  // when the tile (re)mounts mid-call don't re-arm the badge). Reset per call
  // via the [active?.callId] effect above.
  const lastChatIdRef = useRef<string | null | undefined>(undefined);

  // Inbound-guest-line detection → unread badge only. The CHIME lives in the
  // CallSurfaceProvider (main window), not here: this tile is a DocPiP whose
  // document is autoplay-locked until it gets its own gesture, so a tile-owned
  // chime was silent for the first guest message. The badge stays gated to the
  // video face — no point badging the chat face she's already reading.
  useEffect(() => {
    const last = chat.lines[chat.lines.length - 1];
    const lastId = last?.id ?? null;
    if (lastChatIdRef.current === undefined) {
      lastChatIdRef.current = lastId; // seed: treat existing lines as already seen
      return;
    }
    if (lastId === lastChatIdRef.current) return;
    lastChatIdRef.current = lastId;
    if (last && last.from === "guest" && chatMode !== "chat") {
      setChatUnread(true);
    }
  }, [chat.lines, chatMode]);

  // Opening the chat face clears whatever badge was showing.
  useEffect(() => {
    if (chatMode === "chat") setChatUnread(false);
  }, [chatMode]);

  const elapsed = useElapsed(active?.answeredAt ?? 0);
  const localTime = useHotelClock(active?.timeZone ?? null);

  if (!active) return null; // defensive — the tile should be closed by then

  function handle911Tap() {
    if (!controls?.triggerEmergency) return;
    if (armed) {
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      setArmed(false);
      controls.triggerEmergency();
      return;
    }
    setArmed(true);
    armTimerRef.current = setTimeout(() => setArmed(false), EMERGENCY_ARM_WINDOW_MS);
  }

  return (
    <div className="flex h-full w-full flex-col bg-primary text-primary-foreground">
      {/* Face */}
      <div className="relative flex flex-1 flex-col overflow-hidden p-2">
        {/* 911 lives in the face corner (audio-only), isolated from Hang up in
            the control bar — mirrors the full-screen overlay so a hang-up tap
            can never land on 911. Two-tap arm/confirm logic is unchanged. */}
        {controls?.triggerEmergency && (
          <button
            type="button"
            onClick={handle911Tap}
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-button bg-destructive px-2 py-1 text-xs font-semibold text-destructive-foreground shadow-md"
          >
            <AlertTriangle size={13} /> {armed ? "Confirm 911" : "911"}
          </button>
        )}
        {active.channel === "VIDEO" ? (
          chatMode === "chat" ? (
            <div className="relative flex-1 overflow-hidden rounded-md bg-[var(--color-call)]">
              <ChatDock
                lines={chat.lines}
                peerTyping={chat.peerTyping}
                onSend={(t) => controls?.sendChat?.(t)}
                onTyping={(s) => controls?.sendTyping?.(s)}
                className="h-full"
              />
              {guestVideoTrack && (
                <div className="absolute right-2 top-2 z-10 h-14 w-20 overflow-hidden rounded-md border border-primary-foreground/30">
                  <GuestVideo track={guestVideoTrack} />
                </div>
              )}
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden rounded-md bg-[var(--color-call)]">
              {guestVideoTrack ? (
                <GuestVideo track={guestVideoTrack} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-primary-foreground/60">
                  Connecting video…
                </div>
              )}
              {localTime && (
                <div
                  data-testid="hotel-clock-chip"
                  className="absolute left-2 top-2 z-10 flex flex-col gap-0.5 rounded-button bg-black/40 px-2 py-1"
                >
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-live">Hotel</span>
                  <span className="flex items-center gap-1 font-mono text-xs font-semibold">
                    <Clock size={11} /> {localTime}
                  </span>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-xs font-medium text-white">
                {active.propertyName} · {formatElapsed(elapsed)}
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-semibold">{active.propertyName}</p>
            <p className="font-mono text-xs text-primary-foreground/70">{formatElapsed(elapsed)}</p>
            <div className="mt-1">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-live">
                Hotel local time
              </div>
              <div className="font-mono text-lg font-extrabold">{localTime ?? "—"}</div>
            </div>
          </div>
        )}
      </div>

      {/* Caption band (spec D6) — occupies the former notes slot; only when
          captions are on AND there's text, else the face above expands. */}
      {captionsEnabled && (caption.finals.length > 0 || caption.partial) && (
        <div className="px-2 pb-1">
          <CaptionBand finals={caption.finals} partial={caption.partial} className="py-1 text-sm" />
        </div>
      )}

      {/* Compact bar — mirror-only when no controls are registered. */}
      {controls && (
        <div className="flex items-center gap-1.5 border-t border-primary-foreground/15 p-2">
          <button
            type="button"
            onClick={controls.toggleMute}
            aria-pressed={controls.muted}
            className="flex items-center gap-1 rounded-button border border-primary-foreground/25 px-2 py-1 text-xs text-primary-foreground"
          >
            {controls.muted ? <MicOff size={13} /> : <Mic size={13} />}
            {controls.muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            onClick={controls.hangUp}
            className="flex items-center gap-1 rounded-button bg-attention px-2 py-1 text-xs font-semibold text-attention-foreground"
          >
            <PhoneOff size={13} /> Hang up
          </button>
          {/* Video/Chat toggle (Task 9) — video-only, only when the call owner
              registered sendChat. Segmented control mirrors CaptionToggle's
              compact footprint; the unread dot clears the moment chat opens. */}
          {active.channel === "VIDEO" && controls.sendChat && (
            <div className="flex items-center gap-0.5 rounded-button border border-primary-foreground/25 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setChatMode("video")}
                className={
                  chatMode === "video"
                    ? "rounded-[3px] bg-accent px-1.5 py-0.5 text-accent-foreground"
                    : "rounded-[3px] px-1.5 py-0.5 text-primary-foreground/70"
                }
              >
                Video
              </button>
              <button
                type="button"
                onClick={() => setChatMode("chat")}
                className={
                  chatMode === "chat"
                    ? "relative rounded-[3px] bg-accent px-1.5 py-0.5 text-accent-foreground"
                    : "relative rounded-[3px] px-1.5 py-0.5 text-primary-foreground/70"
                }
              >
                Chat
                {chatUnread && (
                  <span
                    data-testid="chat-unread"
                    className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-attention"
                  />
                )}
              </button>
            </div>
          )}
          <CaptionToggle enabled={captionsEnabled} onToggle={toggleCaptions} compact />
          {/* Connect = the remote-in action: teal accent + monitor icon,
              matching the in-tab overlays. 911 is NOT here — it's pinned to
              the face corner above. */}
          <button
            type="button"
            disabled={!active.propertyId}
            onClick={() => {
              if (active.propertyId) void surface?.connectToProperty(active.propertyId);
            }}
            className="ml-auto flex items-center gap-1 rounded-button bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground disabled:opacity-50"
          >
            <Monitor size={13} /> Connect
          </button>
        </div>
      )}
    </div>
  );
}
