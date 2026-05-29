"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setCallAvailabilityAction } from "./properties/actions";

export type AvailabilityRow = {
  propertyId: string;
  propertyName: string;
  accepting: boolean;
};

export function AvailabilityCards({ rows }: { rows: AvailabilityRow[] }) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(rows.map((r) => [r.propertyId, r.accepting])),
  );
  const [, startTransition] = useTransition();

  function onToggle(propertyId: string, next: boolean) {
    const prev = state[propertyId];
    // Optimistic: flip immediately, roll back on failure (spec §9.4).
    setState((s) => ({ ...s, [propertyId]: next }));
    startTransition(async () => {
      const result = await setCallAvailabilityAction(propertyId, next);
      if (!result.ok) {
        setState((s) => ({ ...s, [propertyId]: prev }) as Record<string, boolean>);
        toast.error(result.error);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        No active properties yet. Add a property to set your call availability.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
      {rows.map((r) => (
        <div
          key={r.propertyId}
          className="flex items-center justify-between gap-3 p-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {r.propertyName}
            </span>
            <span className="text-xs text-text-muted">
              {state[r.propertyId] ? "Accepting calls" : "Not accepting calls"}
            </span>
          </div>
          <Switch
            checked={state[r.propertyId]}
            onCheckedChange={(v) => onToggle(r.propertyId, v)}
            aria-label={`Accept calls for ${r.propertyName}`}
          />
        </div>
      ))}
    </div>
  );
}
