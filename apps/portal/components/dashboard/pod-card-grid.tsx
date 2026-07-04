"use client";
// Phase-3 pod grid (spec §3.1, Task 8 step 2): thin responsive layout wrapper
// around PropertyCard. Shared by the agent (Task 8) and admin (Task 9) scopes.

import { PropertyCard, type PropertyCardData } from "@/components/dashboard/property-card";

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
  return (
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
  );
}
