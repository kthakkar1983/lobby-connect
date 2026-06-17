"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { IncomingCallToast } from "@/components/dashboard/incoming-call-toast";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";

type Role = "ADMIN" | "AGENT";

const HOME: Record<Role, Route> = { AGENT: "/agent", ADMIN: "/admin" };

/**
 * The workspace beneath the navy rail: the shared gradient header, the page
 * content, and the persistent softphone.
 *
 * The softphone stays MOUNTED on every route — its Twilio Device must never
 * deregister, so we only toggle the card's visibility, never its presence. On the
 * dashboard home the card shows in the right column; on other routes it is hidden
 * (display:none, still mounted) and `IncomingCallToast` nudges the user home to
 * answer. `VideoCallHost` is always mounted so an active video call can overlay
 * from any route.
 */
export function DashboardWorkspace({
  role,
  fullName,
  email,
  firstName,
  children,
}: {
  readonly role: Role;
  readonly fullName: string;
  readonly email: string;
  readonly firstName: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();
  const home = HOME[role];
  const onHome = pathname === home;

  return (
    <div className="flex flex-col gap-6 p-6">
      <DashboardHeader firstName={firstName}>
        <AccountMenu fullName={fullName} email={email} role={role} />
      </DashboardHeader>

      <div className={onHome ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]" : ""}>
        <main id="main">{children}</main>
        <aside className={onHome ? "flex flex-col gap-3" : "hidden"}>
          <Softphone role={role} />
          {/* Incoming-video banner sits here, in the dead space directly under the
              softphone, instead of floating over the screen. The active VideoCall
              is fixed full-screen (it escapes this container and blocks nav, so
              the aside never hides mid-call). */}
          <VideoCallHost />
        </aside>
      </div>

      <IncomingCallToast home={home} />
    </div>
  );
}
