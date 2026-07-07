"use client";

// Per-property "Connect" — launches the RustDesk native client for the hotel PC
// (spec §3.5). NEVER gated/disabled (D10/D11): agents AND admins, quiet /
// ringing / on-call alike. Renders nothing outside the CallSurfaceProvider.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";

export function ConnectButton({ propertyId }: { propertyId: string }) {
  const surface = useCallSurfaceOptional();
  const [error, setError] = useState<string | null>(null);

  if (!surface) return null;

  async function handleClick() {
    const r = await surface!.connectToProperty(propertyId);
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
      <Button variant="neutral" size="sm" onClick={handleClick}>
        Connect
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
