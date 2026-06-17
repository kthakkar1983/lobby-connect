"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { Phone } from "lucide-react";
import { useLineStatus } from "@/lib/dashboard/line-status";

/**
 * Off-home incoming-call nudge. The softphone stays mounted in the layout so the
 * line is always live, but its Accept UI lives in the dashboard card. When a call
 * rings while the user is on another page, this brings them back to answer.
 * Renders nothing on the dashboard home (the card shows there) or when idle.
 */
export function IncomingCallToast({ home }: { readonly home: Route }) {
  const { phase } = useLineStatus();
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === home || phase !== "incoming") return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-card border border-border bg-card p-4 shadow-lg"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-live/15 text-primary">
        <Phone size={18} />
      </span>
      <div className="text-sm">
        <p className="font-medium text-foreground">Incoming call</p>
        <p className="text-text-muted">Go to your dashboard to answer.</p>
      </div>
      <button
        type="button"
        onClick={() => router.push(home)}
        className="ml-2 rounded-button bg-live px-3 py-1.5 text-sm font-medium text-ink"
      >
        Answer
      </button>
    </div>
  );
}
