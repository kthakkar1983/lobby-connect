"use client";

// Task 14 (outbound-video-calls plan): per-property "Kiosk" button — the
// agent-facing entry point for an agent-initiated OUTBOUND video call to a
// property's kiosk (a call-back for a drop / "I'll get back to you"; the
// reverse of answering an inbound ring). Sibling control to ConnectButton on
// the same card (see connect-button.tsx).
//
// TWO KINDS OF UNAVAILABILITY, DELIBERATELY SPLIT (spec §3.4):
//
//   - `!kioskOnline` and `busy` are REAL: they stay genuinely `disabled` with
//     the reason in `title`. Offering "start your shift" for an offline kiosk
//     would be a lie — starting the shift would not make that button work, so
//     these must never reach the duty guard.
//   - Off duty / on break is NOT handled here any more. <PropertyActionButton>
//     owns it via useDutyGuard: the control stays enabled and the click is
//     intercepted with an offer to start the shift.
//
// ICON: `MonitorPlay` is kept deliberately. The plan's Task 3 snippet wrote
// `MonitorSmartphone`, but that would swap a shipped icon on no authority —
// spec §7 never names a kiosk icon, and MonitorPlay reads as "start something
// on the lobby screen", which is exactly what this does. Recorded so the next
// reviewer does not "restore" the plan's version.
//
// `busy` rides the same `unavailableReason` prop that supplies `title`, so an
// in-flight click also gets a hover string the spec did not ask for. Kept: it
// explains a control that just went dead under the cursor. Pinned in
// kiosk-call-button.test.tsx so it stays a decision.
//
// The kiosk's own liveness drives `kioskOnline` upstream in the page
// (isKioskOnline, Task 3/lib/kiosk/liveness.ts). The server-side gate on
// start-outbound-video (requires on-duty) remains the real lock.
//
// Renders nothing outside the CallSurfaceProvider.

import { MonitorPlay } from "lucide-react";
import { useState } from "react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";

export function KioskCallButton({
  propertyId,
  propertyName,
  kioskOnline,
  className,
}: {
  propertyId: string;
  propertyName: string;
  kioskOnline: boolean;
  /** Batch 1 Task 2: forwarded to PropertyActionButton so pod-card-grid can
   *  stretch this into an equal-width pair with the sibling ConnectButton. */
  className?: string;
}) {
  const surface = useCallSurfaceOptional();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!surface) return null;
  // Captured after the guard so `startOutboundVideo` is non-null here (no `!`).
  const { startOutboundVideo } = surface;

  // Only the non-duty reasons. `busy` deliberately does NOT swap the label:
  // an in-flight click must not resize the control (spec §3.6a/§5.3).
  const unavailableReason = !kioskOnline
    ? "Kiosk offline"
    : busy
      ? "Starting the call…"
      : undefined;

  async function handleClick() {
    if (!kioskOnline || busy) return;
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

  return (
    // Kumar 2026-07-20: an offline kiosk keeps the "Kiosk" label + icon and just
    // greys out (matching the Connect button beside it) -- NO `unavailableLabel`
    // swap to "Kiosk offline". The reason still rides `unavailableReason` -> the
    // hover `title`; the button is disabled either way.
    <PropertyActionButton
      label="Kiosk"
      unavailableReason={unavailableReason}
      icon={<MonitorPlay aria-hidden="true" />}
      onAction={handleClick}
      error={error}
      className={className}
    />
  );
}
