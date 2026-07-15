"use client";

// Task 14 (outbound-video-calls plan): per-property "Kiosk" button — the
// agent-facing entry point for an agent-initiated OUTBOUND video call to a
// property's kiosk (a call-back for a drop / "I'll get back to you"; the
// reverse of answering an inbound ring). Sibling control to ConnectButton on
// the same card (see connect-button.tsx). Greyed out + disabled when the
// kiosk reads offline (isKioskOnline, Task 3/lib/kiosk/liveness.ts drives the
// `kioskOnline` prop upstream in the page). Duty-gated exactly like
// ConnectButton — Task 17's UI defense-in-depth on top of a server-side gate
// (start-outbound-video requires on-duty); a no-op when no DutyProvider is
// mounted. Renders nothing outside the CallSurfaceProvider.

import { MonitorPlay } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDutyOptional } from "@/components/dashboard/duty-provider";

export function KioskCallButton({
  propertyId,
  propertyName,
  kioskOnline,
}: {
  propertyId: string;
  propertyName: string;
  kioskOnline: boolean;
}) {
  const surface = useCallSurfaceOptional();
  const duty = useDutyOptional();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!surface) return null;
  // Captured after the guard so `startOutboundVideo` is non-null here (no `!`).
  const { startOutboundVideo } = surface;

  const dutyGated = duty != null && !duty.canWork;
  const disabled = !kioskOnline || dutyGated || busy;

  async function handleClick() {
    if (disabled) return;
    setBusy(true);
    const r = await startOutboundVideo(propertyId, propertyName);
    setBusy(false);
    setError(
      r.ok
        ? null
        : r.busy
          ? "Already on a call — try again shortly."
          : "Could not start the call — try again.",
    );
  }

  const title = !kioskOnline ? "Kiosk offline" : dutyGated ? "Go on duty to call" : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Button variant="neutral" size="sm" onClick={handleClick} disabled={disabled} title={title}>
        <MonitorPlay aria-hidden="true" />
        {kioskOnline ? "Kiosk" : "Kiosk offline"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
