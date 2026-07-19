"use client";

// Per-property "Connect" — launches the RustDesk native client for the hotel PC
// (spec §3.5). D10/D11 (Phase E): never gated by call phase — agents AND
// admins, quiet / ringing / on-call alike.
//
// The off-duty/on-break gate this file used to compute itself now lives in
// <PropertyActionButton> via useDutyGuard (spec §3.4/D8). Same condition
// (`!canWork`), same no-op when no DutyProvider is mounted — but the control
// now stays ENABLED and the click is intercepted with an offer to start the
// shift, instead of being disabled and relabelled per card. A disabled button
// fires no click event, so it could never be intercepted.
//
// The server 403 on GET /api/remote-access/[propertyId] (requireOnDuty) remains
// the real lock; all of the above is UI defense-in-depth.
//
// Renders nothing outside the CallSurfaceProvider.

import { Monitor } from "lucide-react";
import { useState } from "react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { PropertyActionButton } from "@/components/dashboard/property-action-button";
import { connectErrorMessage } from "@/lib/remote-access/connect-error";

export function ConnectButton({ propertyId }: { propertyId: string }) {
  const surface = useCallSurfaceOptional();
  const [error, setError] = useState<string | null>(null);

  if (!surface) return null;
  // Captured after the guard so `connectToProperty` is non-null here (no `!`).
  const { connectToProperty } = surface;

  async function handleClick() {
    // Task 14: the wording moved to lib/remote-access/connect-error so the three
    // in-call Connects, which had no error handling at all, could adopt this
    // one's behaviour without minting three more copies of the strings.
    setError(connectErrorMessage(await connectToProperty(propertyId)));
  }

  return (
    <PropertyActionButton
      label="Connect"
      icon={<Monitor aria-hidden="true" />}
      onAction={handleClick}
      error={error}
    />
  );
}
