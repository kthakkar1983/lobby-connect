"use client";
// Call-scoped Document-PiP tile face (spec §3.3, Task 17). Renders INSIDE the
// PiP window (portaled by CallSurfaceProvider) and is purely a MIRROR of the
// live call surface — it owns no call/Twilio/LiveKit/911 state of its own.
// Every control here dispatches through `callControls`, registered by whichever
// component owns the live call (Softphone for AUDIO, VideoCall for VIDEO).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MessageSquare,
  Captions,
  CaptionsOff,
  PhoneOff,
  AlertTriangle,
  Monitor,
  Clock,
} from "lucide-react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { CaptionBand } from "@/components/call/caption-band";
import { ChatDock } from "@/components/call/chat-dock";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";
import { connectErrorMessage } from "@/lib/remote-access/connect-error";
import { cn } from "@/lib/utils";

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

/**
 * Round icon-only control for the tile bar (2026-07-21 smoke). The tile is a
 * postcard-sized DocPiP window, so every control except Connect drops its text
 * label and reads as an icon in a round button — the "ghost outline round"
 * language the kiosk uses, scaled down. The icon carries the state (Mic/MicOff,
 * Video/VideoOff) and the accessible name is on `aria-label` (icon-only, so
 * there is no visible text to name it).
 *
 *   - `pressed` undefined  -> a plain suppression toggle (Mute/Camera): ghost
 *     always; the ICON conveys on/off, exactly like the kiosk's Mute/Camera. No
 *     aria-pressed, because the action-label ("Mute"/"Unmute") already carries
 *     the state and a filled highlight is not the kiosk's convention.
 *   - `pressed` boolean    -> a view toggle (Chat): aria-pressed + a teal-tint
 *     fill when engaged, matching <CaptionToggle>'s own "enabled" recipe so the
 *     two active-toggle states read identically. text-accent on the tint clears
 *     the 3:1 icon bar on the navy tile (see the CaptionToggle contrast note).
 */
function TileIconButton({
  onClick,
  ariaLabel,
  title,
  pressed,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  title: string;
  pressed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      title={title}
      className={cn(
        "relative grid size-7 shrink-0 place-items-center rounded-full border transition-transform active:scale-95",
        pressed
          ? "border-accent bg-accent/10 text-accent"
          : "border-primary-foreground/25 text-primary-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
      )}
    >
      {children}
    </button>
  );
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
  // Task 14 / spec §7 — the behavioural gap. Connect called connectToProperty as
  // a bare `void` with no catch, so a failed remote-access launch was SILENT.
  // That matters most here: this is the surface she is looking at when she
  // presses it, with the tab already backgrounded behind RustDesk. Declared up
  // here with the other per-call UI state because the reset effect below clears
  // it alongside them.
  const [connectError, setConnectError] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    // A new call (or the call ending) must not carry a stale armed state, chat
    // mode, chat-unread badge, or Connect failure into the next one.
    setArmed(false);
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setChatMode("video");
    setChatUnread(false);
    setConnectError(null);
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

  const connectPropertyId = active?.propertyId ?? null;
  const connectToProperty = surface?.connectToProperty;
  async function handleConnect() {
    if (!connectPropertyId || !connectToProperty) return;
    try {
      // Invoked synchronously inside the click, before any await, so a pre-warmed
      // cache hit still launches on the click's transient activation.
      // "compact": this window is 380x300 and the bar already carries four
      // controls — the full wording wraps to several lines in what is left.
      setConnectError(connectErrorMessage(await connectToProperty(connectPropertyId), "compact"));
    } catch {
      // connectToProperty runs openTileForCall() and launchRustdesk()
      // synchronously and fetchRemoteCredentials behind an await. A throw from
      // any of them would skip setConnectError entirely and surface as an
      // unhandled rejection — restoring the exact silence this handler exists
      // to end. A thrown connect is not evidence of a missing credential, so it
      // maps to the transient "try again".
      setConnectError(connectErrorMessage({ launched: false }, "compact"));
    }
  }

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
        {/* 911 lives in the face corner (audio-only), isolated from End call in
            the control bar — mirrors the full-screen overlay so an End-call tap
            can never land on 911. Two-tap arm/confirm logic is unchanged. */}
        {controls?.triggerEmergency && (
          <button
            type="button"
            onClick={handle911Tap}
            className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-button bg-destructive px-2 py-1 text-xs font-semibold text-destructive-foreground shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          >
            <AlertTriangle size={13} /> {armed ? "Confirm 911" : "911"}
          </button>
        )}
        {/* Armed-state warning — brings the tab overlay's 911-confirm message
            into the PiP's space. The tile is too small for the full AlertDialog,
            so the two-tap arm/confirm above STAYS (byte-identical); this only
            surfaces WHY the second tap matters. Audio-only like the 911 button
            (armed can only be set from it), so it never collides with the video
            face's bottom bar. `pointer-events-none` so the confirm stays the
            top-right button, not this. */}
        {armed && (
          <div
            role="alert"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-destructive/90 px-2 py-1.5 text-center text-[11px] font-medium leading-snug text-destructive-foreground"
          >
            Conferences 911 into the call. Genuine emergencies only. Tap again to confirm.
          </div>
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
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-live">Property</span>
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
                Property local time
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

      {/* Compact bar — mirror-only when no controls are registered.
          `Connect · Mute · [Camera] · [Chat] · Captions · End call` — Connect
          leads (labelled teal), End call bookends the row (round blaze). The
          2026-07-21 smoke pass made every control EXCEPT Connect an icon-only
          round button (the kiosk "ghost outline round" language, scaled to the
          postcard-sized PiP), and added the Camera toggle (item 4) — dropping the
          text labels is exactly what makes room for it. Camera + Chat are
          VIDEO-only (gated on their registered controls). */}
      {controls && (
        <div className="flex items-center gap-1.5 border-t border-primary-foreground/15 p-2">
          {/* Connect = the remote-in action: teal accent + monitor icon,
              matching the in-tab overlays. 911 is NOT here — it's pinned to
              the face corner above.

              Task 14 moved it onto the shared <PropertyActionButton>, the fifth
              and last of the hand-rolled copies. Three props carry decisions
              that were previously baked into this file's className and would
              otherwise be lost:

              - `tone="teal"` — NOT the default. The 2026-07-10 batch-1 polish
                split the fill navy on the property cards / teal on all three
                in-call Connects; the component defaults to navy.
              - `surface="dark"` — this bar is navy. It buys the error in blaze
                (red would read ~2.5:1 here) and a disabled treatment that mutes
                the FILL instead of dimming the element, which on navy drops the
                label to roughly 2:1.
              - `size="xs"` — the PiP window is the size of a postcard; the
                card scale (`sm`, h-8) is visibly oversized in it.
              - `gate="none"` — NOT decoration either. Duty CAN be revoked while
                this call is live: /api/presence/end-shift flips the profile
                OFFLINE with no ON_CALL guard, so End shift pressed in a SECOND
                dashboard tab (whose own mid-call suppression sees no live call,
                that state being per-tab) gates this one within a heartbeat via
                markOffDuty. Gated, this Connect would be a DEAD CLICK: the
                prompt is an AlertDialog in the main document, and the tile is
                used precisely when that document is backgrounded behind
                RustDesk, so she would see nothing happen at all, mid guest-call.
                Remoting into the hotel PC during a live call is not an off-duty
                action anyway — the guest is on the line whatever the shift row
                says. Withholding it is the failure, not the safeguard.
              - `errorPlacement="float"` — the failure message must not lay out
                in this bar. In flow it wraps to several lines in a 380x300
                window and permanently shrinks the guest's video face.

              Task 5 moved Connect to LEAD the bar (it was last, pushed right
              via `wrapperClassName="ml-auto"`). No wrapper margin is needed
              here anymore since Connect is the first flex child — the
              right-bookend push now lives on End call's own className. */}
          <PropertyActionButton
            label="Connect"
            icon={<Monitor aria-hidden="true" />}
            tone="teal"
            surface="dark"
            size="xs"
            gate="none"
            onAction={handleConnect}
            unavailableReason={connectPropertyId ? null : "This call has no property to connect to"}
            error={connectError}
            errorPlacement="float"
            className="font-semibold"
          />
          {/* Mute — round ghost icon. The icon carries on/off (Mic/MicOff), the
              accessible name carries the action; no visible label (2026-07-21). */}
          <TileIconButton
            onClick={controls.toggleMute}
            ariaLabel={controls.muted ? "Unmute" : "Mute"}
            title={controls.muted ? "Turn your microphone on" : "Turn your microphone off"}
          >
            {controls.muted ? <MicOff size={15} /> : <Mic size={15} />}
          </TileIconButton>
          {/* Camera — round ghost icon, VIDEO-only. Rides the same registered-
              controls seam as chat: only the VIDEO owner registers toggleCamera/
              cameraOff, so an AUDIO call omits it (no camera) and this is absent.
              The accessible name offers the NEXT action ("Camera on" when off),
              matching the kiosk's own label convention. */}
          {active.channel === "VIDEO" && controls.toggleCamera && (
            <TileIconButton
              onClick={controls.toggleCamera}
              ariaLabel={controls.cameraOff ? "Camera on" : "Camera off"}
              title={controls.cameraOff ? "Turn your camera on" : "Turn your camera off"}
            >
              {controls.cameraOff ? <VideoOff size={15} /> : <Video size={15} />}
            </TileIconButton>
          )}
          {/* Chat — a SINGLE round toggle now (2026-07-21), not a Video|Chat
              segmented switch: one icon-only round button consistent with the
              siblings, teal-tinted while chat is the active face, with the unread
              dot on the icon. Video-only (controls.sendChat is registered only by
              the video owner). */}
          {active.channel === "VIDEO" && controls.sendChat && (
            <TileIconButton
              onClick={() => setChatMode((m) => (m === "chat" ? "video" : "chat"))}
              ariaLabel="Chat"
              title={chatMode === "chat" ? "Back to video" : "Open chat"}
              pressed={chatMode === "chat"}
            >
              <MessageSquare size={15} />
              {chatUnread && (
                <span
                  data-testid="chat-unread"
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-attention"
                />
              )}
            </TileIconButton>
          )}
          {/* Captions — hand-rolled as a TileIconButton so it reads identically to
              the sibling round controls (the shared <CaptionToggle> is a labelled
              pill built for the light overlay bar). `pressed` gives it the same
              teal-tint engaged state as <CaptionToggle>'s "enabled" recipe, so the
              navy contrast (text-accent on bg-accent/10, ~4.1:1 — clears the 3:1
              icon bar) is preserved. Title strings are unchanged. */}
          <TileIconButton
            onClick={toggleCaptions}
            ariaLabel="Captions"
            title={captionsEnabled ? "Turn captions off" : "Turn captions on"}
            pressed={captionsEnabled}
          >
            {captionsEnabled ? <Captions size={15} /> : <CaptionsOff size={15} />}
          </TileIconButton>
          {/* End call — round blaze icon, bookended right (`ml-auto`) so a tap can
              never land on it by accident, and separated from the ghost cluster.
              Blaze matches the agent overlay's End call; icon-only, so it cannot
              wrap (the old whitespace-nowrap guard is moot). Accessible name
              "End call", never "Hang up". */}
          <button
            type="button"
            onClick={controls.hangUp}
            aria-label="End call"
            title="End call"
            className="ml-auto grid size-7 shrink-0 place-items-center rounded-full bg-attention text-attention-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          >
            <PhoneOff size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
