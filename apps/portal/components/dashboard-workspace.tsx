"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { CallBackShortcut } from "@/components/dashboard/call-back-shortcut";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ShiftCard } from "@/components/dashboard/shift-card";
import { ZoneClocksCard } from "@/components/dashboard/zone-clocks-card";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { syncPushSubscription } from "@/lib/push/client";

type Role = "ADMIN" | "AGENT";

const HOME: Record<Role, Route> = { AGENT: "/agent", ADMIN: "/admin" };

/**
 * The workspace beneath the navy rail: the shared gradient header, the page
 * content, and the persistent softphone.
 *
 * The softphone stays MOUNTED on every route — its Twilio Device must never
 * deregister, so we only toggle the card's visibility, never its presence. On the
 * dashboard home the card shows in the right column; on other routes it is hidden
 * (display:none, still mounted). `VideoCallHost` is always mounted so an active
 * video call can overlay from any route.
 *
 * Task 9 (Phase 3): the off-home `IncomingCallToast` nudge is retired — the OS
 * push/ring layer + the ringing property cards (dashboard-first answering,
 * spec §3.1/§3.4) now cover the "call is ringing while I'm elsewhere" case, so
 * no route-agnostic in-app toast is needed anymore.
 *
 * Task 15: `<CallBackShortcut>` is agent-only (the spec's drop-moment
 * complement to the agent's own property-card "Kiosk" button) — `role` is
 * plumbed into this component already, so the gate is a plain prop check
 * rather than a second duty/role lookup. Mounted alongside `VideoCallHost`
 * so it's present on every agent route, matching the softphone/video host's
 * always-mounted, route-agnostic lifecycle.
 */
export function DashboardWorkspace({
  role,
  fullName,
  email,
  operatorId,
  firstName,
  children,
}: {
  readonly role: Role;
  readonly fullName: string;
  readonly email: string;
  readonly operatorId: string;
  readonly firstName: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const home = HOME[role];
  const onHome = pathname === home;

  // Silent push re-sync on load: no prompt, refreshes the subscription's
  // last_seen_at so stale endpoints are pruned server-side (Phase 3, Task 12).
  useEffect(() => {
    void syncPushSubscription();
  }, []);

  // The SW focuses a tab and asks it to navigate home on notification click, so
  // the ringing property card is on screen. The hook ignores focus-home (no route
  // knowledge); the workspace owns it.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string };
      if (data?.source === "lc-push" && data.type === "focus-home") router.push(HOME[role]);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router, role]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <DashboardHeader firstName={firstName}>
        <div className="flex items-center gap-3">
          <AccountMenu fullName={fullName} email={email} role={role} />
        </div>
      </DashboardHeader>

      <div className={onHome ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" : ""}>
        <main id="main">{children}</main>
        <aside className={onHome ? "flex flex-col gap-3" : "hidden"}>
          <Softphone role={role} />
          {/* Spec D1: the softphone card keeps its position and is deliberately
              NOT merged into the shift card -- the shift card slots below it.
              Both new cards live here rather than in <main> so they inherit the
              off-home hiding, which is spec §3.5's accepted consequence: an
              ADMIN on a non-home route has no duty affordance and navigates
              home to end a shift (AGENT_NAV has exactly one entry, so an agent
              never hits it, and MAX_SHIFT_MS force-closes a forgotten shift
              regardless). */}
          <ShiftCard />
          <ZoneClocksCard />
          {/* Headless: VideoCallHost renders no chrome of its own (see its
              docblock) — either the fixed full-screen <VideoCall>, which escapes
              this container and blocks nav so the aside never hides mid-call, or
              nothing. So its position below the cards is visually irrelevant;
              only staying MOUNTED matters. */}
          <VideoCallHost operatorId={operatorId} />
        </aside>
      </div>
      {role === "AGENT" ? <CallBackShortcut /> : null}
    </div>
  );
}
