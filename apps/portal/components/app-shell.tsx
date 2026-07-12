import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SkipLink } from "@/components/skip-link";
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";
import { CallSurfaceProvider } from "@/components/dashboard/call-surface-provider";
import { DutyProvider } from "@/components/dashboard/duty-provider";
import { DashboardWorkspace } from "@/components/dashboard-workspace";

type Role = "ADMIN" | "AGENT";

/**
 * The unified agent + admin shell: a navy icon-rail spine and a seam-joined
 * workspace. `role` drives the nav set. The workspace (gradient header + page +
 * persistent softphone) lives in DashboardWorkspace; the softphone's Twilio
 * Device stays mounted there across every route, so the line never drops on
 * navigation. Composition + tokens only; no call logic here.
 */
export function AppShell({
  role,
  fullName,
  email,
  operatorId,
  children,
}: {
  readonly role: Role;
  readonly fullName: string;
  readonly email: string;
  readonly operatorId: string;
  readonly children: React.ReactNode;
}) {
  const firstName =
    (fullName || (role === "ADMIN" ? "Admin" : "Agent")).split(/\s+/)[0] ?? fullName;

  return (
    <LineStatusProvider>
      <CallSurfaceProvider>
        {/* DutyProvider wraps both the header (DutyControl) and the softphone so
            duty state has ONE owner; it sits inside CallSurfaceProvider but is
            deliberately separate from it (no ring/audio ownership → no render-loop
            coupling). See duty-provider.tsx. */}
        <DutyProvider>
          {/* Rest collapsed; the rail hover-expands (see AppSidebar). */}
          <SidebarProvider defaultOpen={false}>
            <AppSidebar role={role} />
            <SidebarInset>
              {/* The seam — the navy-rail | workspace join, carrying the sign-in split. */}
              <div
                className="pointer-events-none absolute inset-y-0 left-0 z-30 w-[2px] bg-[image:var(--gradient-seam-vertical)]"
                aria-hidden="true"
              />
              <SkipLink />
              <DashboardWorkspace
                role={role}
                fullName={fullName}
                email={email}
                operatorId={operatorId}
                firstName={firstName}
              >
                {children}
              </DashboardWorkspace>
            </SidebarInset>
          </SidebarProvider>
        </DutyProvider>
      </CallSurfaceProvider>
    </LineStatusProvider>
  );
}
