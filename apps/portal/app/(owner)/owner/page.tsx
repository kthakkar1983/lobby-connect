import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import type { ProfileStatus, IncidentStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { presenceLabel, presenceDotClass, isLivePresence, formatTimeOnly } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { countOpenIncidents } from "@/lib/owner/summary";
import { startOfTodayUtc } from "@/lib/calls/today-window";
import { AutoRefresh } from "@/components/auto-refresh";
import { Greeting } from "@/components/owner/greeting";
import { StatTile } from "@/components/owner/stat-tile";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";

type SupabaseServer = Awaited<ReturnType<typeof createServerClient>>;

async function resolveAgents(
  supabase: SupabaseServer,
  propIds: string[],
  now: Date,
): Promise<Map<string, { full_name: string; status: ProfileStatus }>> {
  const out = new Map<string, { full_name: string; status: ProfileStatus }>();
  if (propIds.length === 0) return out;
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id, primary_agent_id")
    .in("property_id", propIds)
    .is("effective_until", null);
  const agentIds = [...new Set((assignments ?? []).map((a) => a.primary_agent_id))];
  const raw = new Map<string, { full_name: string; status: ProfileStatus; last_seen_at: string | null }>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabase
      .from("profiles")
      .select("id, full_name, status, last_seen_at")
      .in("id", agentIds);
    for (const a of agents ?? []) raw.set(a.id, { full_name: a.full_name, status: a.status, last_seen_at: a.last_seen_at });
  }
  for (const a of assignments ?? []) {
    const r = raw.get(a.primary_agent_id);
    if (r) out.set(a.property_id, { full_name: r.full_name, status: effectivePresence(r.status, r.last_seen_at, now.getTime()) });
  }
  return out;
}

export default async function OwnerHomePage() {
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();
  const now = new Date();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id)
    .eq("active", true)
    .order("name");

  const props = properties ?? [];
  const propIds = props.map((p) => p.id);

  const [agentByProperty, perProperty, openRows] = await Promise.all([
    resolveAgents(supabase, propIds, now),
    Promise.all(
      props.map(async (p) => {
        const [{ count }, { data: last }] = await Promise.all([
          supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("property_id", p.id)
            .gte("ring_started_at", startOfTodayUtc(p.timezone, now)),
          supabase
            .from("calls")
            .select("ring_started_at")
            .eq("property_id", p.id)
            .order("ring_started_at", { ascending: false })
            .limit(1),
        ]);
        return {
          id: p.id,
          todayCount: count ?? 0,
          lastCall: last && last[0] ? formatTimeOnly(last[0].ring_started_at, p.timezone) : "—",
        };
      }),
    ),
    propIds.length
      ? supabase.from("incidents").select("property_id, status").in("property_id", propIds).neq("status", "RESOLVED")
      : Promise.resolve({ data: [] as { property_id: string; status: IncidentStatus }[] }),
  ]);

  const statByProperty = new Map(perProperty.map((s) => [s.id, s]));
  const openIncidents = openRows.data ?? [];

  const cards = props.map((p) => {
    const agent = agentByProperty.get(p.id) ?? null;
    const stat = statByProperty.get(p.id);
    const openCount = countOpenIncidents(openIncidents.filter((i) => i.property_id === p.id));
    return {
      id: p.id,
      name: p.name,
      agent,
      todayCount: stat?.todayCount ?? 0,
      openCount,
      lastCall: stat?.lastCall ?? "—",
      live: agent ? isLivePresence(agent.status) : false,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="sr-only">Your properties</h1>
      <div>
        <Greeting />
        <p className="mt-1 text-sm text-text-muted">Your properties</p>
      </div>

      {cards.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Building2}
            title={copy.empty.ownerHome.title}
            description={copy.empty.ownerHome.description}
          />
        </Card>
      ) : (
        cards.map((c) => (
          <Link key={c.id} href={`/owner/properties/${c.id}` as never}>
            <Card
              className={cn(
                "gap-3 p-5 transition-colors hover:border-accent/40",
                c.openCount > 0
                  ? "border-l-2 border-l-destructive"
                  : c.live && "border-l-2 border-l-live",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-foreground">{c.name}</span>
                <ChevronRight className="size-5 text-text-muted" aria-hidden="true" />
              </div>
              {c.agent ? (
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <span className={cn("size-2 rounded-full", presenceDotClass(c.agent.status))} aria-hidden="true" />
                  {c.agent.full_name} · {presenceLabel(c.agent.status)}
                </span>
              ) : (
                <span className="text-sm text-text-muted">No agent assigned</span>
              )}
              <div className="flex gap-2">
                <StatTile value={c.todayCount} label="Calls today" />
                <StatTile value={c.openCount} label="Open" alert={c.openCount > 0} />
                <StatTile value={c.lastCall} label="Last call" />
              </div>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
