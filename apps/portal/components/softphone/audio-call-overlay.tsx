"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  AlertTriangle,
  CornerDownLeft,
  Check,
  Loader2,
  PictureInPicture2,
  Monitor,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PlaybookPanel } from "@/components/call/playbook-panel";
import { CaptionBand } from "@/components/call/caption-band";
import { CaptionToggle } from "@/components/call/caption-toggle";
import { CallShell } from "@/components/call/call-shell";
import {
  CallControlDivider,
  CallToggleButton,
  EndCallButton,
} from "@/components/call/call-controls";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";
import { connectErrorMessage, type ConnectOutcome } from "@/lib/remote-access/connect-error";
import { cn } from "@/lib/utils";

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioCallOverlay({
  propertyName,
  callId,
  muted,
  roomNumber,
  notes,
  timeZone,
  emergencyActive,
  emergencyFailed,
  onToggleMute,
  onHangUp,
  onTriggerEmergency,
  onRoomNumberChange,
  onNotesChange,
  onSaveNotes,
  captionFinals,
  captionPartial,
  captionsEnabled,
  onToggleCaptions,
  showReopenTile = false,
  onReopenTile,
  onConnect,
  collapsed = false,
}: {
  readonly propertyName: string;
  readonly callId: string;
  readonly muted: boolean;
  readonly roomNumber: string;
  readonly notes: string;
  readonly timeZone: string | null;
  readonly emergencyActive: boolean;
  readonly emergencyFailed: boolean;
  readonly onToggleMute: () => void;
  readonly onHangUp: () => void;
  readonly onTriggerEmergency: () => void;
  readonly onRoomNumberChange: (value: string) => void;
  readonly onNotesChange: (value: string) => void;
  readonly onSaveNotes: () => Promise<boolean>;
  readonly captionFinals: string[];
  readonly captionPartial: string;
  readonly captionsEnabled: boolean;
  readonly onToggleCaptions: () => void;
  /** Task 17: show the "Reopen tile" affordance (the agent closed the call tile
   *  mid-call and DocPiP is supported). Defaults to false so every existing
   *  caller/test that doesn't pass it renders exactly as before. */
  readonly showReopenTile?: boolean;
  readonly onReopenTile?: () => void;
  /** Phase E (Task 19b): launch the hotel PC's remote-access session for this
   *  call's property. Absent (undefined) when the ringing property is unknown
   *  (nullable propertyId) — the control renders disabled in that case.
   *
   *  Task 14: it now RESOLVES the launch outcome so this overlay can say
   *  something when the launch fails (spec §7). The callback shape stays —
   *  unlike the video overlay and the tile, this one does NOT read the property
   *  off the CallSurfaceProvider; the softphone resolves it and hands down a
   *  closure. That is deliberate and worth keeping: every one of this file's
   *  tests renders it bare, with no provider anywhere. */
  readonly onConnect?: () => Promise<ConnectOutcome>;
  /** Spec D2: when the call tile is up it owns the controls; the overlay hides
   *  its call card so the playbook fills the width. */
  readonly collapsed?: boolean;
}) {
  // Call duration — self-tracked from mount (≈ answer time; not server-authoritative).
  const startRef = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startRef.current) / 1000));

  // Hotel local time — formatter memoized per timezone; invalid tz → null → hidden.
  const fmt = useMemo(() => {
    if (!timeZone) return null;
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [timeZone]);
  const localTime = fmt ? fmt.format(new Date(now)) : null;

  // Explicit in-call notes save (Enter). The post-call durability banner in the
  // softphone remains the backstop; here we give immediate in-field feedback.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  async function handleSave() {
    if (saveState === "saving") return;
    setSaveState("saving");
    const ok = await onSaveNotes();
    setSaveState(ok ? "saved" : "failed");
    if (ok) {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
    }
  }
  // Task 14 / spec §7 — the behavioural gap. This Connect fired its callback and
  // dropped the result on the floor, so a failed remote-access launch was
  // SILENT: mid guest-call the agent pressed Connect, RustDesk never opened, and
  // nothing distinguished "still coming" from "will never come".
  //
  // The state lives HERE rather than in the softphone for two reasons. It
  // matches the other two in-call surfaces, which each own theirs — the drift
  // spec §7 exists to end. And it gets its lifetime for free: this overlay only
  // mounts while `phase === "in-call"`, so a failure from the last call cannot
  // survive into the next one. Softphone-owned state would need explicit
  // per-call clearing, i.e. a new invariant for someone to forget.
  const [connectError, setConnectError] = useState<string | null>(null);
  async function handleConnect() {
    if (!onConnect) return;
    try {
      // Invoked synchronously inside the click, before any await, so a pre-warmed
      // credential cache still launches on the click's transient activation.
      setConnectError(connectErrorMessage(await onConnect()));
    } catch {
      // A throw would skip setConnectError and surface as an unhandled
      // rejection — the exact silence this handler exists to end.
      setConnectError(connectErrorMessage({ launched: false }));
    }
  }

  function onKeyDownSave(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Tab") {
      // Tab saves too (parity with Enter), but does NOT preventDefault — focus
      // still moves normally, so saving is a side effect of tabbing out.
      void handleSave();
    }
  }

  return (
    <CallShell
      title={<>On call{propertyName ? ` · ${propertyName}` : ""}</>}
      /* 911 — audio only, alone in the header's top-right corner. Live even
         while the tile is up: `collapsed` hides the call card and the caption
         band, never the header. */
      emergency={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={emergencyActive}
              className="flex items-center gap-1.5 rounded-button bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <AlertTriangle size={15} /> {emergencyActive ? "911 active" : "Call 911"}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Call emergency services (911)?</AlertDialogTitle>
              <AlertDialogDescription>
                This conferences 911 into the live call: the guest, you, and the dispatcher on one line. It logs a high-priority incident.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Not life-threatening? Cancel and use the property&apos;s local non-emergency number instead. Only continue for a genuine emergency.
            </div>
            {/* FORWARD-COMPAT SEAM: when the on-call-manager notify feature lands (cut from v1), add an
                "also alerts the admin, owner, and property GM" line above. Don't render it until the
                backend actually sends those alerts. */}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onTriggerEmergency} className="bg-destructive text-destructive-foreground">
                Yes, call 911
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
      /* Emergency banners — unchanged. */
      bannersAboveBody={
        <>
          {emergencyActive && !emergencyFailed && (
            <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              Emergency active. 911 is being conferenced in. Stay on the line and relay the property
              address and room number.
            </div>
          )}
          {emergencyFailed && (
            <div className="border-b border-destructive bg-destructive/15 px-4 py-2 text-sm font-medium text-destructive">
              911 dispatch failed. Relay the property address and room number verbally, and have the guest
              hang up and dial 911 directly.
            </div>
          )}
        </>
      }
      /* Body — call card (~30%) + playbook (~70%). Audio has no video to show,
         so the card needs less room than video's stage (spec §4, D9). */
      playbookBasis="70%"
      stage={(basis) => (
        <div
          data-testid="audio-call-card"
          /* `relative` gives the corner reopen button below a positioning
             context (spec §3.4/D3). Safe to host it here: `collapsed` (driven
             by tileMount) and `showReopenTile` (driven by tileClosedByUser) are
             mutually exclusive in call-surface-provider.tsx — opening the tile
             sets tileMount AND clears tileClosedByUser in the same call, and
             the user-close callback does the exact opposite pairing. So
             whenever `showReopenTile` is true, `collapsed` is false and this
             card is visible — the old control-bar placement's fear that
             `collapsed` hides the card here was unfounded. */
          className={cn(
            "relative flex flex-col bg-[var(--color-call)] px-4 pb-6 pt-4 text-white",
            basis,
            collapsed && "hidden",
          )}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            On call · <span className="font-mono tracking-normal">{formatElapsed(elapsed)}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-center text-[15px] font-semibold">{propertyName}</p>
            {/* Calm presence pulse — decorative; honors reduced-motion via the global net. */}
            <span className="relative grid size-14 place-items-center" aria-hidden="true">
              <span className="lc-seam-drift absolute inset-0 rounded-full opacity-60 blur-[2px]" />
              <span className="relative size-6 rounded-full bg-live shadow-[0_0_18px_var(--color-live-glow)]" />
            </span>
            {localTime && (
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-live">Property local time</div>
                <div className="mt-0.5 font-mono text-2xl font-extrabold uppercase tracking-wide">{localTime}</div>
              </div>
            )}
          </div>
          {/* Reopen the call tile, closed by the agent mid-call — matches
              video's corner treatment exactly (spec §3.4/D3), replacing this
              control's old control-bar placement. See the `relative` comment
              above for why the card is guaranteed visible whenever this
              renders. */}
          {showReopenTile && (
            <button
              type="button"
              onClick={onReopenTile}
              title="Reopen tile"
              aria-label="Reopen tile"
              className="absolute bottom-2 right-2 z-10 grid h-10 w-10 place-items-center rounded-full border border-live bg-call/90 text-live shadow-md transition-colors hover:bg-call focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-live focus-visible:ring-offset-2 focus-visible:ring-offset-call"
            >
              <PictureInPicture2 size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      panel={(basis) => <PlaybookPanel callId={callId} basis={collapsed ? "basis-full" : basis} />}
      /* Captions hide while the tile is up (symmetric with the video overlay,
         whose band sits inside the collapsing guest stage) — when the tile owns
         the call surface, live captions belong ONLY in the tile, never doubled.
         ⚠ `hidden` must ride CaptionBand's own className, i.e. land on ITS root.
         A test resolves the band with getByText(...).closest("div"), which walks
         UP from the <p> to CaptionBand's own root div — so an outer wrapper is
         harmless, but moving `hidden` onto a wrapper would leave the resolved
         element unhidden and fail. (An earlier version of this comment claimed
         wrapping itself would break the test; it does not.) */
      bannersBelowBody={
        <CaptionBand
          finals={captionFinals}
          partial={captionPartial}
          className={cn("mx-3 mb-2", collapsed && "hidden")}
        />
      }
      /* Control bar — Room#/Notes (left, Enter-to-save) · Connect · Mute ·
         Captions · divider · End call (spec §3.1). Connect now LEADS the
         cluster rather than trailing before End call, and Mute/Captions sit
         as flat siblings — the <CallControlTray> wrapper is gone. Video's bar
         reads the same way now too (Task 4, spec §3.1: Connect leads, Mute ·
         Camera · Captions sit flat, End call bookends) — both surfaces share
         one order.
         The input group's cap is in REM, not the 560px it used to be inline:
         the root font scales to 112.5% at `lg`, so a px cap stops tracking the
         type scale exactly where it matters (same reasoning as §3.6b). */
      controls={
        <>
          <div className="flex min-w-0 max-w-[35rem] flex-1 items-center gap-2">
            <input
              value={roomNumber}
              onChange={(e) => onRoomNumberChange(e.target.value)}
              onKeyDown={onKeyDownSave}
              placeholder="Room #"
              className="w-24 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <div className="relative flex flex-1 items-center">
              <input
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                onKeyDown={onKeyDownSave}
                placeholder="Call notes"
                className="w-full rounded-input border border-border bg-background py-2 pl-3 pr-9 text-sm text-foreground"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 flex items-center"
              >
                {saveState === "saving" ? (
                  <Loader2 size={16} className="animate-spin text-text-muted motion-reduce:animate-none" />
                ) : saveState === "saved" ? (
                  <Check size={16} className="text-live-foreground" />
                ) : saveState === "failed" ? (
                  <AlertTriangle size={15} className="text-destructive" />
                ) : (
                  <CornerDownLeft size={16} className="text-text-muted" />
                )}
              </span>
              {/* SR-announced save status; the icon above is decorative (aria-hidden). */}
              <span role="status" aria-live="polite" className="sr-only">
                {saveState === "saving"
                  ? "Saving notes"
                  : saveState === "saved"
                    ? "Notes saved"
                    : saveState === "failed"
                      ? "Notes save failed. Retries after the call."
                      : ""}
              </span>
            </div>
          </div>
          {/* Connect (Task 14, spec §7) — one of five sites now sharing
              <PropertyActionButton>. `tone="teal"` is NOT decoration and NOT
              the default: the 2026-07-10 batch-1 polish split the fill navy on
              the property cards / teal on all three in-call Connects, and that
              component defaults to navy, so omitting it silently reverts it.
              `surface` stays light — this bar is `bg-card`, unlike the tile's
              navy one.

              Task 3 (spec §3.1) moves Connect to LEAD this cluster, right
              after the input group, instead of trailing just before End call.
              Its props below are unchanged by the move.

              A missing `onConnect` is REAL unavailability, not duty: the
              ringing call carried no propertyId, and starting a shift would not
              give it one. It must stay natively `disabled` and must never reach
              the duty guard, which would otherwise offer to fix it by starting
              a shift — a lie.

              `gate="none"`: duty can be revoked mid-call from a second tab
              (end-shift has no ON_CALL guard), and remoting into the hotel PC
              during a live call is not an off-duty action. See the header note
              in property-action-button.tsx.

              `errorPlacement="float"`: this bar's geometry is fixed on purpose
              so it cannot move under her hand mid-call; a flow error would grow
              it by ~20px and lift End call and Mute the moment one appeared. */}
          <PropertyActionButton
            label="Connect"
            icon={<Monitor aria-hidden="true" />}
            tone="teal"
            gate="none"
            onAction={handleConnect}
            unavailableReason={onConnect ? null : "This call has no property to connect to"}
            error={connectError}
            errorPlacement="float"
            className="font-semibold"
          />
          {/* Mute and Captions are flat siblings now, not wrapped in
              <CallControlTray> (spec §3.1) — the tray and its `ml-auto` are
              gone with it; the input group's own `flex-1` above already
              right-packs this whole cluster, so nothing here needs to replace
              it. */}
          <CallToggleButton
            label="Mute"
            icon={muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
            pressed={muted}
            title={muted ? "Turn your microphone on" : "Turn your microphone off"}
            onToggle={onToggleMute}
          />
          <CaptionToggle
            enabled={captionsEnabled}
            onToggle={onToggleCaptions}
            /* Fixed box so the label swap ("Captions" / "Captions off") can't
               widen the bar and shift End call sideways. `shrink-0` because
               this one is a hand-rolled <button>: every <Button>-based sibling
               gets it from the button base, so without it this is the ONE item
               a narrow viewport can squeeze below w-36 and wrap — the exact
               reflow the box exists to prevent. */
            className="h-8 w-36 shrink-0 justify-center py-0"
          />
          <CallControlDivider />
          {/* Blaze — see <EndCallButton>'s `tone`. This is the one surface
              where a red 911 and the end-call button coexist; 911 stays red
              and alone in the header. */}
          <EndCallButton tone="blaze" onEnd={onHangUp} />
        </>
      }
    />
  );
}
