"use client";
// Phase-3 pod grid (spec §3.1, Task 8 step 2): thin responsive layout wrapper
// around PropertyCard. Shared by the agent (Task 8) and admin (Task 9) scopes.

import { BellOff } from "lucide-react";

import { useCallSurface, type IncomingRing } from "@/components/dashboard/call-surface-provider";
import { ConnectButton } from "@/components/dashboard/connect-button";
import { KioskCallButton } from "@/components/dashboard/kiosk-call-button";
import { useDutyGuard } from "@/components/dashboard/off-duty-prompt";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";
import { Button } from "@/components/ui/button";

/**
 * Defense-in-depth (Task-8 review finding): a ring must never be audible
 * (Twilio audio / hook ringtone + tab title) but unanswerable. PropertyCard
 * only surfaces a ring whose propertyId matches a rendered card, so a ring
 * with a null propertyId (missing TwiML param) or one for a property outside
 * the rendered pod(s) would otherwise have NO Answer affordance anywhere —
 * the old softphone incoming block that used to catch this is retired.
 * Render a compact fallback card for every such unmatched ring.
 *
 * Extracted from PodCardGrid (Task 9) so the fleet board — which renders one
 * PodCardGrid per pod group — can mount this fallback exactly ONCE at the
 * board level instead of once per group.
 */
export function UnmatchedRingCards({
  unmatched,
}: {
  unmatched: IncomingRing[];
}): React.JSX.Element | null {
  const { actions, silencedKeys, silenceRing } = useCallSurface();
  // Spec §3.6, both channels — same gate as PropertyCard's Answer, for the same
  // reasons. This fallback is a LIVE answer path: leaving it ungated while the
  // real cards intercept would mean an audible ring that silently refuses.
  const { guard } = useDutyGuard();
  if (unmatched.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {unmatched.map((ring) => {
        const silenced = silencedKeys.has(ring.key);
        return (
          <div
            key={ring.key}
            data-live-state="ringing"
            className="scale-[1.02] rounded-[var(--radius-card)] border border-live bg-card p-4 shadow-lg ring-2 ring-live transition-all duration-[var(--duration-standard)]"
          >
            <h3 className="font-semibold text-foreground">{ring.propertyName}</h3>
            <p className="text-sm font-medium text-live-foreground">
              Incoming {ring.channel === "AUDIO" ? "phone" : "video"} call
            </p>
            <div className="mt-3 flex items-center gap-2">
              {/* Never `disabled` off duty, label never swaps, and no gated
                  fill — spec §3.4/D8. Mirrors PropertyCard's Answer exactly;
                  the reasoning for all three lives there. */}
              <Button
                onClick={() =>
                  guard(() =>
                    ring.channel === "AUDIO"
                      ? actions.acceptAudio?.()
                      : ring.callId && actions.acceptVideo?.(ring.callId),
                  )
                }
                size="sm"
                className="animate-pulse"
              >
                Answer
              </Button>
              {/* Silenced is real unavailability, not a duty gate (spec §3.4). */}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PodCardGrid({
  properties,
  canAnswerByProperty,
  connectFor,
  footerFor,
  showUnmatchedRings = true,
}: {
  properties: PropertyCardData[];
  /** Admins: gated by covering (D11), keyed by property id. Omitted => canAnswer defaults true (agents). */
  canAnswerByProperty?: Record<string, boolean>;
  /**
   * Optional per-property Connect override; defaults to <ConnectButton> (Phase E).
   * Must be ALL-OR-NOTHING across the grid: returning a slot for some properties
   * and null for others gives sibling cards different heights (property-card.tsx
   * renders that row conditionally, and no reservation can size an arbitrary
   * slot). Return a disabled control rather than null.
   */
  connectFor?: (propertyId: string) => React.ReactNode;
  /** Task 9: the admin fleet board injects the per-property Covering toggle here. */
  footerFor?: (propertyId: string) => React.ReactNode;
  /**
   * The unmatched-ring fallback belongs on the page ONCE. The single-pod agent
   * dashboard (one grid) keeps it here (default true); the admin fleet board
   * renders many grids (one per pod) and hoists the fallback itself, so every
   * per-pod grid it renders passes false.
   */
  showUnmatchedRings?: boolean;
}): React.JSX.Element {
  const { rings } = useCallSurface();
  const propertyIds = new Set(properties.map((p) => p.id));
  const unmatched = rings.filter((r) => r.propertyId === null || !propertyIds.has(r.propertyId));

  return (
    <div className="flex flex-col gap-4">
      {showUnmatchedRings && <UnmatchedRingCards unmatched={unmatched} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {properties.map((property) => (
          <PropertyCard
            key={property.id}
            property={property}
            canAnswer={canAnswerByProperty ? (canAnswerByProperty[property.id] ?? false) : true}
            connectSlot={
              connectFor ? (
                connectFor(property.id)
              ) : (
                // Batch 1 Task 2: a shared 2-col grid track instead of a plain
                // flex row, so Connect (~106px of text) and Kiosk (~85px) fill
                // equal-width columns rather than sizing to their own labels.
                // `w-full` (2026-07-21 smoke): the grid must span the whole card,
                // not shrink to its content, so this row lines up with the
                // Answer/Silence grid above it (property-card.tsx card-action-row).
                <div className="grid w-full grid-cols-2 gap-2">
                  <ConnectButton propertyId={property.id} className="w-full justify-center" />
                  <KioskCallButton
                    propertyId={property.id}
                    propertyName={property.name}
                    kioskOnline={property.kioskOnline}
                    className="w-full justify-center"
                  />
                </div>
              )
            }
            footerSlot={footerFor ? footerFor(property.id) : null}
          />
        ))}
      </div>
    </div>
  );
}
