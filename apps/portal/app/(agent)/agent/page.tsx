import { Phone, Building2 } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { getAgentCoverage } from "@/lib/auth/agent-coverage";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import { DashTile } from "@/components/dashboard/dash-tile";
import { HourlyLegend, HourlyVolumeChart } from "@/components/dashboard/channel-viz";
import {
  countByOutcome,
  avgPickupSeconds,
  avgCallLengthSeconds,
  sumTodayDurationSeconds,
  hourlyVolume,
  isTodayInZone,
  countToday,
} from "@/lib/dashboard/calls";
import { formatDuration } from "@/lib/owner/format";
import { RecentCallRow, type RecentCall } from "@/components/dashboard/recent-call-row";
import { AutoRefresh } from "@/components/auto-refresh";
import { PodCardGrid } from "@/components/dashboard/pod-card-grid";
import type { PropertyCardData } from "@/components/dashboard/property-card";
import { isKioskOnline } from "@/lib/kiosk/liveness";

const LABEL = "font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";

export default async function AgentDashboardPage() {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();
  const now = new Date();

  const { properties } = await getAgentCoverage(actor.id); // cached — shares the layout's reads
  const covered = properties.map((p) => ({ id: p.id, name: p.name, timeZone: p.timezone }));
  const tzById = new Map(covered.map((p) => [p.id, p.timeZone]));
  const nameById = new Map(covered.map((p) => [p.id, p.name]));

  // RLS scopes agents to the calls they personally handled (see 0004 calls_select);
  // a 48h window covers "today" in every covered timezone.
  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const [{ data: raw }, { data: kioskRows }] = await Promise.all([
    supabase
      .from("calls")
      .select("id, property_id, channel, state, direction, ring_started_at, answered_at, duration_seconds, room_number, caller_number, notes")
      .eq("handled_by_user_id", actor.id)
      .gte("ring_started_at", since)
      .order("ring_started_at", { ascending: false }),
    // Task 14: per-property kiosk liveness for the Kiosk button/dot
    // (kiosks_select_operator RLS — operator-scoped, mirrors the calls read).
    supabase.from("kiosks").select("property_id, last_seen_at").eq("operator_id", actor.operator_id),
  ]);

  const calls = (raw ?? []).map((c) => ({
    ...c,
    timeZone: tzById.get(c.property_id) ?? "UTC",
    propertyName: nameById.get(c.property_id) ?? "—",
  }));

  const outcomes = countByOutcome(calls, now);
  const avgPickup = avgPickupSeconds(calls, now);
  const avgCallLen = avgCallLengthSeconds(calls, now);
  const talkTime = sumTodayDurationSeconds(calls, now);
  const hourly = hourlyVolume(calls, now);
  const todayTotal = countToday(calls, now);
  const recentRows: RecentCall[] = calls.slice(0, 6).map((c) => ({
    id: c.id,
    channel: c.channel,
    state: c.state,
    direction: c.direction,
    room_number: c.room_number,
    caller_number: c.caller_number,
    ring_started_at: c.ring_started_at,
    duration_seconds: c.duration_seconds,
    notes: c.notes,
    propertyName: c.propertyName,
    timeZone: c.timeZone,
  }));

  const kioskSeenAt = new Map((kioskRows ?? []).map((k) => [k.property_id, k.last_seen_at]));
  const cards: PropertyCardData[] = covered.map((p) => {
    const propCalls = calls.filter((c) => c.property_id === p.id);
    const today = propCalls.filter((c) => isTodayInZone(c.ring_started_at, p.timeZone, now));
    return {
      id: p.id,
      name: p.name,
      timezone: p.timeZone,
      callsTonight: today.length,
      lastCallAt: propCalls[0]?.ring_started_at ?? null,
      openIncidents: 0, // agent RLS has no incident read; admin scope fills this (Task 9)
      kioskOnline: isKioskOnline(kioskSeenAt.get(p.id) ?? null, now.getTime()),
    };
  });

  return (
    <>
      <section className="flex flex-col gap-4">
        <AutoRefresh />
        <h1 className="sr-only">Agent dashboard</h1>

        <Card className="gap-3 p-5 shadow-md">
          <h2 className={LABEL}>Your pod</h2>
          {cards.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={copy.empty.agentProperties.title}
              description={copy.empty.agentProperties.description}
              className="py-6"
            />
          ) : (
            <PodCardGrid properties={cards} />
          )}
        </Card>

        <div className="flex gap-3">
          <DashTile value={outcomes.answered} label="Answered" />
          <DashTile value={outcomes.missed} label="Missed" tone={outcomes.missed > 0 ? "attention" : "default"} />
          <DashTile value={formatDuration(avgPickup)} label="Avg pickup" />
          <DashTile value={formatDuration(avgCallLen)} label="Avg call length" />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <Card className="gap-3 p-5 shadow-md">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={LABEL}>Hourly call volume</h2>
            <HourlyLegend />
          </div>
          <p className="text-xs text-text-muted">
            Total call duration: {formatDuration(talkTime)}
          </p>
          {todayTotal > 0 ? (
            <HourlyVolumeChart data={hourly} className="mt-1" />
          ) : (
            <EmptyState
              icon={Phone}
              title="No calls yet tonight"
              description="Calls you handle will chart here through the shift."
              className="py-8"
            />
          )}
        </Card>

        <Card className="gap-2 p-5 shadow-md">
          <h2 className={LABEL}>Recent calls</h2>
          {recentRows.length === 0 ? (
            <EmptyState
              icon={Phone}
              title={copy.empty.agentCalls.title}
              description={copy.empty.agentCalls.description}
              className="py-8"
            />
          ) : (
            <ul className="flex flex-col">
              {recentRows.map((c) => (
                <RecentCallRow key={c.id} call={c} />
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
