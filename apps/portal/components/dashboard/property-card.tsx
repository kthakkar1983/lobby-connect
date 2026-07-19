"use client";
// Phase-3 property card (spec §3.1): one card per property, both dashboards.
// Ringing expands in place; Answer claims through the EXISTING accept flows
// via CallSurfaceProvider (D1/D2). Connect is injected via connectSlot (Phase E).

import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCallSurface } from "@/components/dashboard/call-surface-provider";
import { useDutyGuard } from "@/components/dashboard/off-duty-prompt";
import { cardLiveState, type CardLiveState } from "@/lib/dashboard/pods";
import { formatTimeOnly } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

export interface PropertyCardData {
  id: string;
  name: string;
  timezone: string;
  callsTonight: number;
  lastCallAt: string | null;
  openIncidents: number;
  /** Task 14 (outbound-video-calls plan): drives the kiosk-liveness dot next
   *  to the name + the KioskCallButton's disabled/label state. Pages compute
   *  this via isKioskOnline (lib/kiosk/liveness.ts) against kiosks.last_seen_at. */
  kioskOnline: boolean;
}

const STATE_LINE: Record<CardLiveState, string> = {
  ringing: "Ringing",
  "on-hold": "On hold",
  "on-call": "On a call",
  quiet: "Quiet",
};

export function PropertyCard({
  property,
  canAnswer = true,
  connectSlot = null,
  footerSlot = null,
}: {
  property: PropertyCardData;
  /** Admins: gated by covering (D11). Agents: always true. */
  canAnswer?: boolean;
  /** The per-property Connect button (Phase E), supplied by PodCardGrid. */
  connectSlot?: React.ReactNode;
  /** Task 9: the admin fleet board injects the per-property Covering toggle here. */
  footerSlot?: React.ReactNode;
}): React.JSX.Element {
  const { rings, active, actions, silencedKeys, silenceRing, openTileForCall } = useCallSurface();
  // Spec §3.6: ONE duty gate for Answer, on BOTH channels.
  //
  // This replaces Task 17's `answerGated`, which was deliberately VIDEO-only:
  // a server 403 (requireOnDuty on answer-video) backs video and nothing backs
  // audio-answer, so audio's Answer was left enabled, pulsing, and silently
  // no-opping at softphone.tsx:587 — a control that looked live and did nothing.
  // Routing both channels through the guard retires that asymmetry and turns the
  // refusal into an explanation. The server 403 is still the real gate for
  // video; this, like every other duty gate in the UI, is presentation only.
  //
  // No-op when no DutyProvider is mounted (owner surfaces + isolated tests):
  // useDutyGuard passes straight through.
  const { guard } = useDutyGuard();
  const ring = rings.find((r) => r.propertyId === property.id) ?? null;
  const silenced = ring ? silencedKeys.has(ring.key) : false;
  const onCallHere = active?.propertyId === property.id;
  const state = cardLiveState({
    ringing: !!ring,
    onHold: !!active?.onHold && onCallHere,
    onCall: onCallHere,
  });

  // Elapsed ring time, ticking while ringing.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ring) return;
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [ring]);
  const elapsed = ring ? Math.max(0, Math.floor((nowMs - ring.since) / 1_000)) : 0;

  const answer = () => {
    if (!ring) return;
    openTileForCall(); // must run synchronously inside the click gesture (Document-PiP)
    if (ring.channel === "AUDIO") actions.acceptAudio?.();
    else if (ring.callId) actions.acceptVideo?.(ring.callId);
  };

  const ringing = state === "ringing";
  return (
    <div
      data-live-state={state}
      // `flex flex-col` exists to make the action block bottom-anchorable
      // (spec §3.6c): the grid stretches every card to its row height, so
      // pinning the actions to the bottom aligns them across cards no matter
      // how many lines each property name takes. "Holiday Inn Express
      // Southgate" wraps to two at the current width — an ordinary hotel name,
      // not an edge case — and used to push its own buttons out of line.
      // Reserving a two-line name height was rejected: it breaks on three lines
      // and wastes a line on every single-line card. Bottom-anchoring is
      // indifferent to line count.
      className={`flex flex-col rounded-[var(--radius-card)] border bg-card p-4 shadow-sm transition-all duration-[var(--duration-standard)] ${
        ringing ? "scale-[1.02] border-live ring-2 ring-live shadow-lg" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-foreground">
            {property.name}
            <span
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                property.kioskOnline ? "bg-live" : "bg-muted-foreground/40",
              )}
              title={property.kioskOnline ? "Kiosk online" : "Kiosk offline"}
              aria-hidden="true"
            />
          </h3>
          <p className={`text-sm ${ringing ? "font-medium text-live-foreground" : "text-muted-foreground"}`}>
            {STATE_LINE[state]}
            {ringing && ring
              ? ` · ${ring.channel === "AUDIO" ? "phone" : "video"} · ${elapsed}s`
              : ""}
          </p>
        </div>
        {property.openIncidents > 0 && (
          <Badge variant="attention">
            {property.openIncidents} open incident{property.openIncidents > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {/* The `mb-3` is load-bearing and pairs with the action block's `mt-auto`
          below. On the TALLEST card in a grid row there is no free space left to
          distribute, so `mt-auto` computes to 0 — and the tallest card is
          precisely the two-line-name card §3.6c is about. The minimum gap has to
          come from an element that contributes it unconditionally. */}
      <p className="mt-3 mb-3 text-xs text-muted-foreground">
        {property.callsTonight} call{property.callsTonight === 1 ? "" : "s"} tonight
        {property.lastCallAt ? ` · last ${formatTimeOnly(property.lastCallAt, property.timezone)}` : ""}
      </p>

      {/* Reserve the ringing action row so a ring changes colour and content but
          never GEOMETRY (spec §3.6b/D16). Answer and Silence render only while
          ringing, so a ringing card used to be one button-row taller — and CSS
          Grid sizes a row to its tallest item, so one ring grew every card
          beside it and shoved everything below down, at the exact moment the
          agent was reaching for Answer. A target that moves under the cursor
          when it matters most is the defect; the ragged rows were only the
          visible symptom.

          The WRAPPER is always rendered at h-8; only its children are
          conditional. An always-rendered empty row cannot be focused, cannot be
          read by a screen reader, and needs no invisible/aria-hidden/tabIndex
          juggling.

          The reserved height is DERIVED from the control (h-8 is the button's
          own height via size="sm") — never a min-height pixel constant. The root
          font scales to 112.5% at lg, so a px constant would stop matching the
          buttons it is reserving for.

          `mt-auto` lives here because this is the FIRST of the two action rows:
          it pins the whole action block to the bottom of the flex column (§3.6c).
          Accepted cost: every quiet card is one button row taller than before —
          a one-time static cost traded for never shifting during a live ring. */}
      <div className="mt-auto flex h-8 items-center gap-2">
        {ringing && canAnswer && (
          // Never `disabled` off duty: a disabled button fires no click event,
          // so the guard could not intercept it and could not offer to start
          // the shift (spec §3.4/D8). The label never swaps either — see the
          // useDutyGuard note above.
          //
          // It also carries no gated FILL, unlike the Connect/Kiosk buttons
          // beside it (PropertyActionButton's `gatedFill`, which recedes them
          // to bg-primary/70 with the contrast figure computed). Deliberate,
          // not drift: Answer is mint `bg-live` under an ink label and no
          // equivalent figure has been computed for a muted mint, spec §3.6
          // asks only that the label swap go, and a ringing Answer is the one
          // control on this card that must stay maximally findable.
          <Button onClick={() => guard(answer)} size="sm" className="animate-pulse">
            Answer
          </Button>
        )}
        {ringing && ring && (
          // Silenced is REAL unavailability, not a duty gate, so it stays
          // genuinely disabled (spec §3.4).
          <Button
            variant="neutral"
            size="sm"
            onClick={() => silenceRing(ring.key)}
            disabled={silenced}
            aria-pressed={silenced}
          >
            <BellOff aria-hidden="true" />
            {silenced ? "Silenced" : "Silence"}
          </Button>
        )}
      </div>

      {/* Connect + Kiosk get their OWN row and must stay out of the reserved one
          above: that row is fixed at h-8, which would crop these buttons and cut
          off the inline error <p role="alert"> PropertyActionButton renders
          beneath them on a failed launch. No `mt-auto` here — the row above
          already anchored the block, and a second one would split it. */}
      {connectSlot && <div className="mt-2 flex items-center gap-2">{connectSlot}</div>}
      {footerSlot && <div className="mt-3 border-t border-border pt-3">{footerSlot}</div>}
    </div>
  );
}
