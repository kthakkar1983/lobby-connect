"use client";
// Phase-3 pod grid (spec §3.1, Task 8 step 2): thin responsive layout wrapper
// around PropertyCard. Shared by the agent (Task 8) and admin (Task 9) scopes.

import { BellOff } from "lucide-react";

import { useCallSurface, type IncomingRing } from "@/components/dashboard/call-surface-provider";
import { ConnectButton } from "@/components/dashboard/connect-button";
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
              <Button
                onClick={() =>
                  ring.channel === "AUDIO" ? actions.acceptAudio?.() : ring.callId && actions.acceptVideo?.(ring.callId)
                }
                className="animate-pulse"
              >
                Answer
              </Button>
              <Button
                variant="neutral"
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
  /** Phase E injects the per-property Connect button here; omitted until then. */
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
            connectSlot={connectFor ? connectFor(property.id) : <ConnectButton propertyId={property.id} />}
            footerSlot={footerFor ? footerFor(property.id) : null}
          />
        ))}
      </div>
    </div>
  );
}
