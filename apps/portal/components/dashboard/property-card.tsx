"use client";
// Phase-3 property card (spec §3.1): one card per property, both dashboards.
// Ringing expands in place; Answer claims through the EXISTING accept flows
// via CallSurfaceProvider (D1/D2). Connect is injected via connectSlot (Phase E).

import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCallSurface } from "@/components/dashboard/call-surface-provider";
import { cardLiveState, type CardLiveState } from "@/lib/dashboard/pods";
import { formatTimeOnly } from "@/lib/owner/format";

export interface PropertyCardData {
  id: string;
  name: string;
  timezone: string;
  callsTonight: number;
  lastCallAt: string | null;
  openIncidents: number;
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
      className={`rounded-[var(--radius-card)] border bg-card p-4 shadow-sm transition-all duration-[var(--duration-standard)] ${
        ringing ? "scale-[1.02] border-live ring-2 ring-live shadow-lg" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">{property.name}</h3>
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

      <p className="mt-3 text-xs text-muted-foreground">
        {property.callsTonight} call{property.callsTonight === 1 ? "" : "s"} tonight
        {property.lastCallAt ? ` · last ${formatTimeOnly(property.lastCallAt, property.timezone)}` : ""}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {ringing && canAnswer && (
          <Button onClick={answer} className="animate-pulse">
            Answer
          </Button>
        )}
        {ringing && ring && (
          <Button
            variant="neutral"
            onClick={() => silenceRing(ring.key)}
            disabled={silenced}
            aria-pressed={silenced}
          >
            <BellOff aria-hidden="true" />
            {silenced ? "Silenced" : "Silence"}
          </Button>
        )}
        {connectSlot}
      </div>
      {footerSlot && <div className="mt-3 border-t border-border pt-3">{footerSlot}</div>}
    </div>
  );
}
