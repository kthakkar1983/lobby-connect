import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { Wordmark } from "@/components/brand/wordmark";
import { UserMenu } from "@/components/user-menu";
import { Card } from "@/components/ui/card";
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", actor.id)
    .maybeSingle();

  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id")
    .eq("primary_agent_id", actor.id)
    .is("effective_until", null);

  const ids = (assignments ?? []).map((a) => a.property_id);
  let coverage: { id: string; name: string }[] = [];
  if (ids.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, name")
      .in("id", ids)
      .order("name");
    coverage = (props ?? []) as typeof coverage;
  }

  return (
    <LineStatusProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="flex h-14 items-center justify-between px-6">
            <Link href="/agent" aria-label="Lobby Connect home">
              <Wordmark />
            </Link>
            <UserMenu
              fullName={profile?.full_name ?? "Agent"}
              email={profile?.email ?? ""}
              role="AGENT"
            />
          </div>
          <div className="h-px w-full bg-[image:var(--gradient-seam)]" aria-hidden="true" />
        </header>
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
          <main>{children}</main>
          <aside className="flex flex-col gap-3">
            <Softphone role="AGENT" />
            <VideoCallHost />
            <Card className="gap-2 p-4">
              <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                Properties you cover
              </h2>
              {coverage.length === 0 ? (
                <p className="text-sm text-text-muted">No properties assigned.</p>
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
          </aside>
        </div>
      </div>
    </LineStatusProvider>
  );
}
