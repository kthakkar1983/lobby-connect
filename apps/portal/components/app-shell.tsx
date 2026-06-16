import { Building2 } from "lucide-react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SkipLink } from "@/components/skip-link";
import { AccountMenu } from "@/components/account-menu";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";

type Role = "ADMIN" | "AGENT";

type Coverage = { readonly id: string; readonly name: string };

/**
 * The unified agent + admin shell: a navy icon-rail spine, a seam-joined
 * workspace, and a persistent right call-rail. One structure for both portals;
 * `role` drives the nav set and `coverage` (agent only) the rail's coverage card.
 *
 * Functional surfaces are mounted verbatim — Softphone, VideoCallHost, and the
 * LineStatusProvider (which both roles now share, so the admin softphone reports
 * a live line status too). Composition + tokens only; no call logic here.
 */
export function AppShell({
  role,
  fullName,
  email,
  coverage,
  children,
}: {
  readonly role: Role;
  readonly fullName: string;
  readonly email: string;
  readonly coverage?: readonly Coverage[];
  readonly children: React.ReactNode;
}) {
  return (
    <LineStatusProvider>
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
          <header className="sticky top-0 z-20 flex h-14 items-center justify-end border-b border-border bg-card px-4">
            <AccountMenu fullName={fullName} email={email} role={role} />
          </header>
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <main id="main">{children}</main>
            <aside className="flex flex-col gap-3">
              <Softphone role={role} />
              <VideoCallHost />
              {coverage && (
                <Card className="gap-2 p-4">
                  <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                    Properties you cover
                  </h2>
                  {coverage.length === 0 ? (
                    <EmptyState
                      icon={Building2}
                      title={copy.empty.agentProperties.title}
                      description={copy.empty.agentProperties.description}
                      className="gap-2 px-2 py-6"
                    />
                  ) : (
                    <ul className="flex flex-col">
                      {coverage.map(({ id, name }) => (
                        <li
                          key={id}
                          className="border-b border-border py-2 text-sm text-foreground last:border-0"
                        >
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </aside>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LineStatusProvider>
  );
}
