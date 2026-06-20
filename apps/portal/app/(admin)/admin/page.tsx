import Link from "next/link";
import type { Route } from "next";
import { Phone, Building2 } from "lucide-react";
import type { ProfileStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatTile } from "@/components/owner/stat-tile";
import { DashTile } from "@/components/dashboard/dash-tile";
import { HourlyLegend, HourlyVolumeChart } from "@/components/dashboard/channel-viz";
import { AvailabilityToggle } from "./availability-cards";
import {
  countByOutcome,
  avgPickupSeconds,
  avgCallLengthSeconds,
  sumTodayDurationSeconds,
  hourlyVolume,
  countLiveCalls,
  countToday,
} from "@/lib/dashboard/calls";
import { countOnlineAgents } from "@/lib/dashboard/presence";
import { phoneHealthRollup } from "@/lib/dashboard/phone-health";
import { presenceDotClass, presenceLabel, formatDuration } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { cn } from "@/lib/utils";
import { RecentCallRow, type RecentCall } from "@/components/dashboard/recent-call-row";

const LABEL = "font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";

type Tone = "default" | "live" | "attention" | "destructive";

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();
  const now = new Date();
  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();

  const [
    { data: properties },
    { data: agents },
    { count: openIncidents },
    { data: avail },
    { data: assigns },
    { data: rawCalls },
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
    supabase
      .from("calls")
      .select(
        "id, property_id, channel, state, ring_started_at, answered_at, duration_seconds, room_number, caller_number, notes, handled_by_user_id"
      )
      .eq("operator_id", actor.operator_id)
      .gte("ring_started_at", since)
      .order("ring_started_at", { ascending: false }),
  ]);

  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const calls = (rawCalls ?? []).map((c) => ({
    ...c,
    timeZone: tzById.get(c.property_id) ?? "UTC",
    propertyName: nameById.get(c.property_id) ?? "—",
  }));

  // Assigned-agent profiles (2-query merge — direct join on auth users doesn't work).
  const agentIds = [...new Set((assigns ?? []).map((a) => a.primary_agent_id))];
  let agentProfiles: {
    id: string;
    full_name: string;
    status: ProfileStatus;
    last_seen_at: string | null;
  }[] = [];
  if (agentIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, status, last_seen_at")
      .in("id", agentIds);
    agentProfiles = (data ?? []) as typeof agentProfiles;
  }
  const profileById = new Map(agentProfiles.map((p) => [p.id, p]));
  const agentByProperty = new Map(
    (assigns ?? []).map((a) => [a.property_id, profileById.get(a.primary_agent_id) ?? null])
  );
  const acceptingMap = new Map((avail ?? []).map((a) => [a.property_id, a.accepting_calls]));

  // Aggregates (operator-wide — ADMIN reads all operator calls under RLS).
  const live = countLiveCalls(calls);
  const onlineAgents = countOnlineAgents(
    (agents ?? []) as { status: ProfileStatus; last_seen_at: string | null }[],
    now.getTime()
  );
  const outcomes = countByOutcome(calls, now);
  const avgPickup = avgPickupSeconds(calls, now);
  const avgCallLen = avgCallLengthSeconds(calls, now);
  const talkTime = sumTodayDurationSeconds(calls, now);
  const hourly = hourlyVolume(calls, now);
  const todayTotal = countToday(calls, now);
  const recent = calls.slice(0, 8);

  // Resolve handler names for the operator-wide recent feed (2-query merge —
  // direct join on auth users doesn't work). Handlers may be agents OR admins,
  // so this is separate from the assigned-agent presence fetch above.
  const handlerIds = [
    ...new Set(recent.map((c) => c.handled_by_user_id).filter((id): id is string => !!id)),
  ];
  const handlerById = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const p of data ?? []) handlerById.set(p.id, p.full_name);
  }
  const recentRows: RecentCall[] = recent.map((c) => ({
    id: c.id,
    channel: c.channel,
    state: c.state,
    room_number: c.room_number,
    caller_number: c.caller_number,
    ring_started_at: c.ring_started_at,
    duration_seconds: c.duration_seconds,
    notes: c.notes,
    propertyName: c.propertyName,
    timeZone: c.timeZone,
    handlerName: c.handled_by_user_id ? (handlerById.get(c.handled_by_user_id) ?? "—") : "—",
  }));

  // Phone health: a property "needs attention" only on a concrete failure — >= 1
  // FAILED call today. Presence-based coverage-gap and a global "path down" are v2
  // seams (see lib/dashboard/phone-health.ts): the old coverage-gap rule
  // false-alarmed on a covered property whose primary agent simply happened to be
  // offline, which is the normal after-hours setup.
  const health = phoneHealthRollup(
    props.map((p) => ({ id: p.id, name: p.name, timeZone: tzById.get(p.id) ?? "UTC" })),
    calls,
    now
  );
  const attentionIds = new Set(health.needAttention.map((p) => p.id));

  const healthTile: { value: string; sub: string; tone: Tone } =
    health.total === 0
      ? { value: "—", sub: "no properties", tone: "default" }
      : health.needAttention.length > 0
        ? {
            value: `${health.ok}/${health.total}`,
            sub: `${health.needAttention.length} need attention`,
            tone: "attention",
          }
        : { value: `${health.ok}/${health.total}`, sub: "lines OK", tone: "live" };

  const countByProp = (id: string) =>
    countToday(
      calls.filter((c) => c.property_id === id),
      now
    );

  // Problem properties float to the top of the board.
  const boardRows = props
    .map((p) => ({ ...p, attention: attentionIds.has(p.id) }))
    .sort((a, b) => Number(b.attention) - Number(a.attention) || a.name.localeCompare(b.name));

  // Team on now — one row per assigned agent, with how many properties they cover.
  const teamMap = new Map<string, { agent: (typeof agentProfiles)[number]; propCount: number }>();
  for (const a of assigns ?? []) {
    const agent = profileById.get(a.primary_agent_id);
    if (!agent) continue;
    const entry = teamMap.get(agent.id) ?? { agent, propCount: 0 };
    entry.propCount += 1;
    teamMap.set(agent.id, entry);
  }
  const team = [...teamMap.values()];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Admin command center</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DashTile
          value={live.total}
          label="Live calls"
          sub={`${live.audio} phone · ${live.video} video`}
          tone={live.total > 0 ? "live" : "default"}
          href="/admin/calls"
        />
        <DashTile value={onlineAgents} label="Agents online" sub={`of ${(agents ?? []).length}`} />
        <DashTile
          value={openIncidents ?? 0}
          label="Open incidents"
          tone={(openIncidents ?? 0) > 0 ? "attention" : "default"}
        />
        <DashTile
          value={healthTile.value}
          label="Phone health"
          sub={healthTile.sub}
          tone={healthTile.tone}
          href="/admin/phone-health"
        />
      </div>

      <Card className="gap-3 p-5 shadow-md">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={LABEL}>Tonight · all agents</h2>
          <HourlyLegend />
        </div>
        <p className="text-xs text-text-muted">Total call duration: {formatDuration(talkTime)}</p>
        {todayTotal > 0 ? (
          <HourlyVolumeChart data={hourly} className="mt-1" />
        ) : (
          <EmptyState
            icon={Phone}
            title="No calls yet tonight"
            description="Operator-wide call volume will chart here as the shift runs."
            className="py-8"
          />
        )}
        <div className="mt-1 flex gap-3">
          <StatTile
            value={outcomes.answered}
            label="Answered"
            href={"/admin/calls?outcome=answered" as Route}
          />
          <StatTile
            value={outcomes.missed}
            label="Missed"
            alert={outcomes.missed > 0}
            href={"/admin/calls?outcome=missed" as Route}
          />
          <StatTile
            value={outcomes.failed}
            label="Failed"
            href={"/admin/calls?outcome=failed" as Route}
          />
          <StatTile value={formatDuration(avgPickup)} label="Avg pickup" />
          <StatTile value={formatDuration(avgCallLen)} label="Avg call" />
        </div>
      </Card>

      <Card className="gap-3 p-5 shadow-md">
        <h2 className={LABEL}>Properties</h2>
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
            {boardRows.map((p) => {
              const agent = agentByProperty.get(p.id);
              const effective: ProfileStatus | null = agent
                ? effectivePresence(agent.status, agent.last_seen_at, now.getTime())
                : null;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      {p.name}
                      {p.attention ? <Badge variant="attention">Needs attention</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    {agent && effective ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block h-2 w-2 rounded-full",
                            presenceDotClass(effective)
                          )}
                          aria-hidden="true"
                        />
                        {agent.full_name}
                        <span className="text-xs text-text-muted">{presenceLabel(effective)}</span>
                      </span>
                    ) : (
                      <span className="text-text-muted">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{countByProp(p.id)}</TableCell>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-2 p-5 shadow-md">
          <h2 className={LABEL}>Team on now</h2>
          {team.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No agents assigned"
              description="Assign primary agents to properties to staff the line."
              className="py-6"
            />
          ) : (
            <ul className="flex flex-col">
              {team.map(({ agent, propCount }) => {
                const effective: ProfileStatus = effectivePresence(
                  agent.status,
                  agent.last_seen_at,
                  now.getTime()
                );
                return (
                  <li
                    key={agent.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"
                  >
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <span
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          presenceDotClass(effective)
                        )}
                        aria-hidden="true"
                      />
                      {agent.full_name}
                    </span>
                    <span className="font-mono text-xs text-text-muted">
                      {propCount} {propCount === 1 ? "property" : "properties"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="gap-2 p-5 shadow-md">
          <div className="flex items-center justify-between">
            <h2 className={LABEL}>Recent calls</h2>
            <Link href="/admin/calls" className="text-sm text-accent-text hover:underline">
              View all
            </Link>
          </div>
          {recentRows.length === 0 ? (
            <EmptyState
              icon={Phone}
              title="No calls yet"
              description="Operator-wide call activity will show here."
              className="py-6"
            />
          ) : (
            <ul className="flex flex-col">
              {recentRows.map((c) => (
                <RecentCallRow key={c.id} call={c} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
