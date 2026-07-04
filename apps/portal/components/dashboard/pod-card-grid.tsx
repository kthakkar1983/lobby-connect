"use client";
// Phase-3 pod grid (spec §3.1, Task 8 step 2): thin responsive layout wrapper
// around PropertyCard. Shared by the agent (Task 8) and admin (Task 9) scopes.

import { useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";
import { Button } from "@/components/ui/button";

export function PodCardGrid({
  properties,
  canAnswerByProperty,
  connectFor,
}: {
  properties: PropertyCardData[];
  /** Admins: gated by covering (D11), keyed by property id. Omitted => canAnswer defaults true (agents). */
  canAnswerByProperty?: Record<string, boolean>;
  /** Phase E injects the per-property Connect button here; omitted until then. */
  connectFor?: (propertyId: string) => React.ReactNode;
}): React.JSX.Element {
  // Defense-in-depth (Task-8 review finding): a ring must never be audible
  // (Twilio audio / hook ringtone + tab title) but unanswerable. PropertyCard
  // only surfaces a ring whose propertyId matches a rendered card, so a ring
  // with a null propertyId (missing TwiML param) or one for a property
  // outside this agent's rendered pod would otherwise have NO Answer
  // affordance anywhere — the old softphone incoming block that used to
  // catch this is retired. Render a compact fallback card for every such
  // unmatched ring, above the grid, so Answer is always reachable.
  const { rings, actions } = useCallSurface();
  const propertyIds = new Set(properties.map((p) => p.id));
  const unmatched = rings.filter((r) => r.propertyId === null || !propertyIds.has(r.propertyId));

  return (
    <div className="flex flex-col gap-4">
      {unmatched.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {unmatched.map((ring) => (
            <div
              key={ring.key}
              data-live-state="ringing"
              className="scale-[1.02] rounded-[var(--radius-card)] border border-live bg-card p-4 shadow-lg ring-2 ring-live transition-all duration-[var(--duration-standard)]"
            >
              <h3 className="font-semibold text-foreground">{ring.propertyName}</h3>
              <p className="text-sm font-medium text-live-foreground">
                Incoming {ring.channel === "AUDIO" ? "phone" : "video"} call
              </p>
              <div className="mt-3">
                <Button
                  onClick={() =>
                    ring.channel === "AUDIO" ? actions.acceptAudio?.() : ring.callId && actions.acceptVideo?.(ring.callId)
                  }
                  className="animate-pulse"
                >
                  Answer
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {properties.map((property) => (
          <PropertyCard
            key={property.id}
            property={property}
            canAnswer={canAnswerByProperty ? (canAnswerByProperty[property.id] ?? false) : true}
            connectSlot={connectFor ? connectFor(property.id) : null}
          />
        ))}
      </div>
    </div>
  );
}
