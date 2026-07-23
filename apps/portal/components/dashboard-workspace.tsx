"use client";

import { useEffect } from "react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { CallBackShortcut } from "@/components/dashboard/call-back-shortcut";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DutyCard } from "@/components/dashboard/duty-card";
import { ZoneClocksCard } from "@/components/dashboard/zone-clocks-card";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { syncPushSubscription } from "@/lib/push/client";

type Role = "ADMIN" | "AGENT";

const HOME: Record<Role, Route> = { AGENT: "/agent", ADMIN: "/admin" };

/**
 * The workspace beneath the navy rail: the shared gradient header, the page
 * content, and the persistent duty rail.
 *
 * The right rail's top tile is `<DutyCard>`, which renders the softphone and the
 * shift card under one shared card. DutyCard — and therefore the softphone it
 * mounts — stays MOUNTED on every route: the softphone's Twilio Device must never
 * deregister, so we only toggle the aside's visibility, never its presence. On the
 * dashboard home the aside shows in the right column; on other routes it is hidden
 * (display:none, still mounted). Do NOT conditionally render DutyCard or give it a
 * key — either would remount the softphone and re-register a fresh Device.
 * `VideoCallHost` is always mounted so an active video call can overlay from any
 * route.
 *
 * Home layout (Task 5): on lg the grid wrapper is a 2-row grid; `<main>` and the
 * `<aside>` each span both rows (`lg:row-span-2`) and adopt them as a subgrid, so
 * `<main>`'s two page sections and the rail's two tiles (DutyCard on row 1,
 * ZoneClocksCard on row 2) land on the SAME row lines — the tile edges align with
 * the section edges by construction. `lg:gap-6` on both subgrids matches the
 * parent row gap so the row boundaries coincide; below lg both are a plain flex
 * stack. The rail is NO LONGER sticky: a full-height rail that aligns to the left
 * column's rows cannot also be sticky, so it now scrolls with the page. Do NOT
 * re-add items-stretch / h-full / mt-auto — the subgrid needs none of them (an
 * earlier mt-auto pin over-shot the clocks to the page bottom; the subgrid places
 * them on row 2 directly). VideoCallHost is the aside's 3rd child but renders
 * either nothing or a position:fixed overlay, so it never occupies a subgrid row.
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

      <div className={onHome ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-2" : ""}>
        <main
          id="main"
          className={
            onHome ? "flex flex-col gap-4 lg:grid lg:grid-rows-subgrid lg:row-span-2 lg:gap-6" : undefined
          }
        >
          {children}
        </main>
        <aside
          className={
            onHome ? "flex flex-col gap-3 lg:grid lg:grid-rows-subgrid lg:row-span-2 lg:gap-6" : "hidden"
          }
        >
          {/* Row-1 tile. DutyCard merges the softphone + shift under one shared
              card (Task 5). It -- and the softphone's Twilio Device -- must stay
              mounted on every route, so it lives in the always-rendered aside and
              only the aside's visibility toggles off-home. No conditional render,
              no key: either would remount the softphone and re-register a fresh
              Device. Kept here rather than in <main> so it inherits the off-home
              hiding, spec §3.5's accepted consequence: an ADMIN on a non-home
              route has no duty affordance and navigates home to end a shift
              (AGENT_NAV has one entry, so an agent never hits it, and MAX_SHIFT_MS
              force-closes a forgotten shift regardless). */}
          <DutyCard role={role} />
          {/* Row-2 tile. On lg the aside is a 2-row subgrid (mirroring the left
              column), so the clocks land level with <main>'s second section by
              construction. Do NOT re-add items-stretch / h-full / mt-auto to "pin"
              them lower -- the subgrid positions this on row 2 directly (an
              earlier mt-auto pin over-shot to the page bottom; see the docblock). */}
          <ZoneClocksCard />
          {/* Headless: VideoCallHost renders no chrome of its own (see its
              docblock) — either the fixed full-screen <VideoCall>, which escapes
              this container (position:fixed, out of flow) and blocks nav so the
              aside never hides mid-call, or nothing. It is the aside's 3rd child
              but adds NO grid item in either state, so the 2-row subgrid stays
              exact; its position below the cards is visually irrelevant, only
              staying MOUNTED matters. */}
          <VideoCallHost operatorId={operatorId} />
        </aside>
      </div>
      {role === "AGENT" ? <CallBackShortcut /> : null}
    </div>
  );
}
