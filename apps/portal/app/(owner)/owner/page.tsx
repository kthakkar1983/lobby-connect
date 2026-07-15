import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import type { Route } from "next";
import type { ProfileStatus, IncidentStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { presenceLabel, presenceDotClass, isLivePresence, formatTimeOnly } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { countOpenIncidents } from "@/lib/owner/summary";
import { startOfTodayUtc } from "@/lib/calls/today-window";
import { AutoRefresh } from "@/components/auto-refresh";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatTile } from "@/components/owner/stat-tile";
import { PropertyOverview, type OverviewCall } from "@/components/owner/property-overview";
import type { CallRowData } from "@/components/call/call-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";

type SupabaseServer = Awaited<ReturnType<typeof createServerClient>>;

type PropertyRow = { id: string; name: string; timezone: string };

/** Resolve the single property's active primary agent + effective presence. */
async function resolveAgent(
  supabase: SupabaseServer,
  propertyId: string,
  now: Date,
): Promise<{ full_name: string; status: ProfileStatus } | null> {
  const { data: assignment } = await supabase
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null)
    .maybeSingle();
  if (!assignment) return null;
  const { data: a } = await supabase
    .from("profiles")
    .select("full_name, status, last_seen_at")
    .eq("id", assignment.primary_agent_id)
    .maybeSingle();
  if (!a) return null;
  return { full_name: a.full_name, status: effectivePresence(a.status, a.last_seen_at, now.getTime()) };
}

/** Resolve active primary agents for many properties (multi-hotel card grid). */
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
  const firstName = actor.full_name.split(/\s+/)[0] ?? actor.full_name;

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id)
    .eq("active", true)
    .order("name");
  const props = properties ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <AutoRefresh />
      <h1 className="sr-only">Your hotel</h1>
      <DashboardHeader firstName={firstName} />
      {props.length === 1 ? (
        <SingleHotel supabase={supabase} property={props[0]!} now={now} />
      ) : (
        <MultiHotel supabase={supabase} props={props} now={now} />
      )}
    </div>
  );
}

async function SingleHotel({
  supabase,
  property,
  now,
}: {
  supabase: SupabaseServer;
  property: PropertyRow;
  now: Date;
}) {
  const since = startOfTodayUtc(property.timezone, now);
  const [agent, { data: callsRaw }, { data: openRows }] = await Promise.all([
    resolveAgent(supabase, property.id, now),
    supabase
      .from("calls")
      .select(
        "id, channel, state, direction, ring_started_at, answered_at, duration_seconds, room_number, caller_number, notes, recording_url, handled_by_user_id",
      )
      .eq("property_id", property.id)
      .gte("ring_started_at", since)
      .order("ring_started_at", { ascending: false }),
    supabase.from("incidents").select("status").eq("property_id", property.id).neq("status", "RESOLVED"),
  ]);
  const rows = callsRaw ?? [];

  const handlerIds = [...new Set(rows.map((c) => c.handled_by_user_id).filter((x): x is string => !!x))];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  const todayCalls: OverviewCall[] = rows.map((c) => ({
    ring_started_at: c.ring_started_at,
    timeZone: property.timezone,
    state: c.state,
    direction: c.direction,
    channel: c.channel,
    answered_at: c.answered_at,
  }));
  const recent: CallRowData[] = rows.slice(0, 5).map((c) => ({
    secondary: [
      c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
      c.room_number ? `Room ${c.room_number}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    detail: {
      id: c.id,
      channel: c.channel,
      state: c.state,
      direction: c.direction,
      caller_number: c.caller_number,
      room_number: c.room_number,
      ring_started_at: c.ring_started_at,
      duration_seconds: c.duration_seconds,
      notes: c.notes,
      recording_url: c.recording_url,
      propertyName: property.name,
      timeZone: property.timezone,
      handlerName: c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
    },
  }));

  return (
    <PropertyOverview
      propertyId={property.id}
      propertyName={property.name}
      agent={agent}
      todayCalls={todayCalls}
      recent={recent}
      openIncidents={countOpenIncidents(openRows ?? [])}
      now={now}
    />
  );
}

async function MultiHotel({
  supabase,
  props,
  now,
}: {
  supabase: SupabaseServer;
  props: PropertyRow[];
  now: Date;
}) {
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

  if (cards.length === 0) {
    return (
      <Card className="p-0">
        <EmptyState
          icon={Building2}
          title={copy.empty.ownerHome.title}
          description={copy.empty.ownerHome.description}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {cards.map((c) => (
        <Link key={c.id} href={`/owner/properties/${c.id}` as Route}>
          <Card
            className={cn(
              "gap-3 p-5 transition-colors hover:border-accent/40",
              c.openCount > 0 ? "border-l-2 border-l-attention" : c.live && "border-l-2 border-l-live",
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
      ))}
    </div>
  );
}
