"use client";
// Phase-3 admin fleet board (spec §3.1, Task 9): replaces the admin properties
// ops <Table> with pod-grouped property cards. One header row per PodGroup
// (agent identity + live presence + duty label + property count), then that
// pod's cards via the shared PodCardGrid. The Covering AvailabilityToggle
// moves from the old table onto each card's footer slot; the unmatched-ring
// fallback is hoisted here and rendered exactly once (see UnmatchedRingCards).

import { useEffect, useState } from "react";
import { AvailabilityToggle } from "@/app/(admin)/admin/availability-cards";
import { useCallSurface } from "@/components/dashboard/call-surface-provider";
import { PodCardGrid, UnmatchedRingCards } from "@/components/dashboard/pod-card-grid";
import type { PropertyCardData } from "@/components/dashboard/property-card";
import { dutyLabel, type PodAgent } from "@/lib/dashboard/pods";
import { presenceDotClass } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { cn } from "@/lib/utils";

/** Same shape as PodGroup (lib/dashboard/pods.ts), with card data swapped in
 *  for the bare PodProperty — the server page derives cards, this stays a
 *  thin, fully-serializable rendering layer. */
export interface FleetPodGroup {
  /** null = the trailing "Unassigned" group (spec §3.1 / groupPodsByAgent). */
  agent: PodAgent | null;
  properties: PropertyCardData[];
}

export function FleetBoard({
  groups,
  canAnswerByProperty,
  coveringByProperty,
}: {
  groups: FleetPodGroup[];
  /** Answer gated by covering (D11), keyed by property id. */
  canAnswerByProperty: Record<string, boolean>;
  /** Drives the per-card Covering AvailabilityToggle's initial state. */
  coveringByProperty: Record<string, boolean>;
}): React.JSX.Element {
  const { rings } = useCallSurface();
  const allPropertyIds = new Set(groups.flatMap((g) => g.properties.map((p) => p.id)));
  const unmatched = rings.filter((r) => r.propertyId === null || !allPropertyIds.has(r.propertyId));

  // Presence is time-relative (effectivePresence needs "now"); compute it
  // client-side, ticking once a minute so a stale heartbeat ages out live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nameByProperty = new Map<string, string>();
  for (const g of groups) for (const p of g.properties) nameByProperty.set(p.id, p.name);

  return (
    <div className="flex flex-col gap-6">
      <UnmatchedRingCards unmatched={unmatched} />
      {groups.map((group) => {
        const agent = group.agent;
        const effective = agent ? effectivePresence(agent.status, agent.last_seen_at, nowMs) : null;
        const key = agent?.id ?? "unassigned";
        return (
          <div key={key} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              {effective && (
                <span
                  className={cn("inline-block h-2 w-2 rounded-full", presenceDotClass(effective))}
                  aria-hidden="true"
                />
              )}
              <h3 className="text-sm font-semibold text-foreground">
                {agent ? agent.full_name : "Unassigned"}
              </h3>
              {agent && effective && (
                <span className="text-xs text-text-muted">{dutyLabel(agent.status, agent.last_seen_at, nowMs)}</span>
              )}
              <span className="text-xs text-text-muted">
                · {group.properties.length} {group.properties.length === 1 ? "property" : "properties"}
              </span>
            </div>
            <PodCardGrid
              properties={group.properties}
              canAnswerByProperty={canAnswerByProperty}
              showUnmatchedRings={false}
              footerFor={(propertyId) => (
                <AvailabilityToggle
                  propertyId={propertyId}
                  propertyName={nameByProperty.get(propertyId) ?? propertyId}
                  initial={coveringByProperty[propertyId] ?? false}
                />
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
