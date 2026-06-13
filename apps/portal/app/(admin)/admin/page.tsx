import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { AvailabilityToggle } from "./availability-cards";
import { countOnlineAgents } from "@/lib/dashboard/presence";
import { startOfTodayUtc } from "@/lib/calls/today-window";
import { presenceDotClass, presenceLabel } from "@/lib/owner/format";
import { isStale } from "@/lib/voice/presence";
import { cn } from "@/lib/utils";
import type { ProfileStatus } from "@lc/shared";

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();
  const now = new Date();

  // Stage 1 — operator-scoped reads, independent of property ids.
  const [
    { data: properties },
    { data: agents },
    { count: openIncidents },
    { data: avail },
    { data: assigns },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, timezone")
      .eq("operator_id", actor.operator_id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("profiles")
      .select("status, last_seen_at")
      .eq("operator_id", actor.operator_id)
      .eq("role", "AGENT")
      .eq("active", true),
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("operator_id", actor.operator_id)
      .eq("status", "OPEN"),
    supabase
      .from("admin_call_availability")
      .select("property_id, accepting_calls")
      .eq("profile_id", actor.id),
    supabase
      .from("property_assignments")
      .select("property_id, primary_agent_id")
      .eq("operator_id", actor.operator_id)
      .is("effective_until", null),
  ]);

  const props = properties ?? [];

  // Stage 2 — per-property "today" counts (count queries; tz-aware window).
  const todayCounts = new Map<string, number>(
    await Promise.all(
      props.map(async (p) => {
        const { count } = await supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("property_id", p.id)
          .gte("ring_started_at", startOfTodayUtc(p.timezone, now));
        return [p.id, count ?? 0] as [string, number];
      }),
    ),
  );
  const callsToday = [...todayCounts.values()].reduce((a, b) => a + b, 0);

  // Agent profiles (2-query pattern) — unchanged.
  const agentIds = [...new Set((assigns ?? []).map((a) => a.primary_agent_id))];
  let agentProfiles: { id: string; full_name: string; status: ProfileStatus; last_seen_at: string | null }[] =
    [];
  if (agentIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, status, last_seen_at")
      .in("id", agentIds);
    agentProfiles = (data ?? []) as typeof agentProfiles;
  }
  const profileById = new Map(agentProfiles.map((p) => [p.id, p]));

  const onlineAgents = countOnlineAgents(
    (agents ?? []) as { status: ProfileStatus; last_seen_at: string | null }[],
    now.getTime(),
  );
  const acceptingMap = new Map(
    (avail ?? []).map((a) => [a.property_id, a.accepting_calls]),
  );
  const acceptingCount = props.filter((p) => acceptingMap.get(p.id)).length;
  const agentByProperty = new Map(
    (assigns ?? []).map((a) => [
      a.property_id,
      profileById.get(a.primary_agent_id) ?? null,
    ]),
  );
  const todayByProperty = (id: string) => todayCounts.get(id) ?? 0;

  const firstName = (actor.full_name || "Admin").split(/\s+/)[0] ?? "Admin";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <GreetingLine firstName={firstName} />
        <p className="text-sm text-text-muted">
          Admin overview — users, properties, and call coverage for your
          operator.
        </p>
      </header>

      <div className="flex gap-3">
        <StatTile value={onlineAgents} label="Agents online" />
        <StatTile value={callsToday} label="Calls today" />
        <StatTile
          value={openIncidents ?? 0}
          label="Open incidents"
          alert={(openIncidents ?? 0) > 0}
        />
        <StatTile value={`${acceptingCount}/${props.length}`} label="Accepting" />
      </div>

      <Card className="gap-3 p-5">
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          Properties
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Primary agent</TableHead>
              <TableHead>Calls today</TableHead>
              <TableHead>Covering</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.map((p) => {
              const agent = agentByProperty.get(p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    {p.name}
                  </TableCell>
                  <TableCell>
                    {agent ? (
                      <span className="inline-flex items-center gap-2">
                        {(() => {
                          const effective: ProfileStatus = isStale(agent.last_seen_at, now.getTime()) ? "OFFLINE" : agent.status;
                          return (
                            <>
                              <span
                                className={cn(
                                  "inline-block h-2 w-2 rounded-full",
                                  presenceDotClass(effective),
                                )}
                              />
                              {agent.full_name}
                              <span className="text-xs text-text-muted">
                                {presenceLabel(effective)}
                              </span>
                            </>
                          );
                        })()}
                      </span>
                    ) : (
                      <span className="text-text-muted">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">
                    {todayByProperty(p.id)}
                  </TableCell>
                  <TableCell>
                    <AvailabilityToggle
                      propertyId={p.id}
                      propertyName={p.name}
                      initial={acceptingMap.get(p.id) ?? false}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
