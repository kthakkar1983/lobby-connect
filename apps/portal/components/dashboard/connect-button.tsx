"use client";

// Per-property "Connect" — launches the RustDesk native client for the hotel PC
// (spec §3.5). D10/D11 (Phase E): never gated by call phase — agents AND
// admins, quiet / ringing / on-call alike. Task 17 (shift-tracking plan) adds
// ONE additional gate on top of that: off-duty/on-break. The server 403 on
// GET /api/remote-access/[propertyId] (requireOnDuty) is the real lock — this
// is UI defense-in-depth, and only applies when a DutyProvider is actually
// mounted (owner surfaces + isolated component tests render this button with
// no DutyProvider, so useDutyOptional() no-ops and behavior is unchanged).
// Renders nothing outside the CallSurfaceProvider.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";
import { useDutyOptional } from "@/components/dashboard/duty-provider";

export function ConnectButton({ propertyId }: { propertyId: string }) {
  const surface = useCallSurfaceOptional();
  const duty = useDutyOptional();
  const [error, setError] = useState<string | null>(null);

  if (!surface) return null;
  // Captured after the guard so `connectToProperty` is non-null here (no `!`).
  const { connectToProperty } = surface;

  const gated = duty != null && !duty.canWork;

  async function handleClick() {
    if (gated) return;
    const r = await connectToProperty(propertyId);
    if (r.launched) {
      setError(null);
      return;
    }
    setError(
      r.notConfigured
        ? "No remote access configured — ask an admin."
        : "Could not fetch credentials — try again.",
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="neutral"
        size="sm"
        onClick={handleClick}
        disabled={gated}
        title={gated ? "Go on duty to start" : undefined}
      >
        {gated ? "Go on duty to start" : "Connect"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
