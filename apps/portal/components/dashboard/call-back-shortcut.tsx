"use client";

// Task 15 (outbound-video-calls plan): the drop-moment complement to the
// property-card "Kiosk" button (Task 14, kiosk-call-button.tsx). Any call —
// inbound or outbound, audio or video — that ends leaves the just-ended
// property's id/name in CallSurfaceProvider.recentlyEnded for
// RECONNECT_WINDOW_MS (packages/shared/src/protocol.ts: paired with the
// kiosk's own post-drop tap lockout, so the agent has right-of-way to
// reconnect). This renders a small floating pill for that window so "the
// video dropped, reconnect now" is one click away without hunting for the
// property card. Reuses startOutboundVideo (Task 12) — the same action the
// Kiosk button calls — so busy/offline/duty gating all happen server-side
// exactly as they do there.
//
// Renders nothing outside CallSurfaceProvider, and nothing once the window
// lapses: the provider owns clearing `recentlyEnded`, including EARLY if a
// new call goes active (see call-surface-provider.tsx), so this component
// never needs to cross-check `active` itself.

import { PhoneOutgoing } from "lucide-react";
import { useEffect, useState } from "react";
import { useCallSurfaceOptional } from "@/components/dashboard/call-surface-provider";

export function CallBackShortcut() {
  const surface = useCallSurfaceOptional();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = surface?.recentlyEnded;

  // Reset the transient busy/error whenever a NEW pill appears. Unlike
  // KioskCallButton (mounted per-property with a fixed subject), this is a
  // SINGLE persistent instance whose subject changes over its lifetime — so
  // without this, a stale error from a prior call-back attempt (e.g. a 409 on
  // Property A that lingered in state after A's 10s window lapsed) would bleed
  // onto a later, unrelated Property B pill. `recentlyEnded` is a fresh object
  // on every provider set (including the same property calling back twice), so
  // identity-keying resets on genuinely-new pills only. It must NOT reset on a
  // same-pill click failure: a 409/failure leaves `active` null and the
  // provider never re-sets `recentlyEnded`, so its identity is unchanged and
  // this effect no-ops — THIS pill's own error still shows for THIS pill. Runs
  // BEFORE the early return below so the hook order stays unconditional.
  useEffect(() => {
    if (ended) {
      setError(null);
      setBusy(false);
    }
  }, [ended]);

  if (!surface || !ended) return null;
  // Captured after the guard so both are non-null here (no `!`), mirroring
  // kiosk-call-button.tsx — destructuring propertyId/propertyName out of
  // `ended` (rather than closing over `ended` itself) also sidesteps a real
  // TS limitation: narrowing a nullable binding via `if (!ended) return`
  // does NOT persist into a nested function declaration like handleClick
  // below, so `ended.propertyId` there would still type as possibly-null.
  const { startOutboundVideo } = surface;
  const { propertyId, propertyName } = ended;

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    const r = await startOutboundVideo(propertyId, propertyName);
    setBusy(false);
    setError(
      r.ok
        ? null
        : r.busy
          ? "Already on a call. Try again shortly."
          : "Could not start the call. Try again.",
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-md disabled:pointer-events-none disabled:opacity-50"
      >
        <PhoneOutgoing size={14} aria-hidden="true" />
        Call {propertyName} back
      </button>
      {error ? (
        <p className="rounded-full bg-card px-3 py-1 text-xs text-destructive shadow-md" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
