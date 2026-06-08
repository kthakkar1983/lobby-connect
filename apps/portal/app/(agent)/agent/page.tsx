import { Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { LineBeacon } from "@/components/dashboard/line-beacon";
import { countToday, avgPickupSeconds, sumTodayDurationSeconds } from "@/lib/dashboard/calls";
import { formatDuration, formatTimeOnly } from "@/lib/owner/format";

export default async function AgentDashboardPage() {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();
  const now = new Date();

  // Group A (no deps): profile name + active assignments — run in parallel
  const [{ data: profile }, { data: assignments }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", actor.id).maybeSingle(),
    supabase
      .from("property_assignments")
      .select("property_id")
      .eq("primary_agent_id", actor.id)
      .is("effective_until", null),
  ]);

  const fullName = profile?.full_name ?? "Agent";
  const firstName = fullName.split(/\s+/)[0] ?? fullName;

  const coveredIds = (assignments ?? []).map((a) => a.property_id);

  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();

  // Group B (needs coveredIds): properties lookup + handled calls — run in parallel
  const [{ data: props }, { data: handledRaw }] = await Promise.all([
    coveredIds.length > 0
      ? supabase.from("properties").select("id, name, timezone").in("id", coveredIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("calls")
      .select("id, property_id, ring_started_at, answered_at, duration_seconds, room_number")
      .eq("handled_by_user_id", actor.id)
      .gte("ring_started_at", since)
      .order("ring_started_at", { ascending: false }),
  ]);

  const covered: Array<{ id: string; name: string; timeZone: string }> = (props ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    timeZone: p.timezone,
  }));
  const tzById = new Map(covered.map((p) => [p.id, p.timeZone]));
  const nameById = new Map(covered.map((c) => [c.id, c.name]));

  const handled = (handledRaw ?? []).map((c) => ({
    id: c.id,
    ring_started_at: c.ring_started_at,
    answered_at: c.answered_at,
    duration_seconds: c.duration_seconds,
    room_number: c.room_number,
    propertyName: nameById.get(c.property_id) ?? "—",
    timeZone: tzById.get(c.property_id) ?? "UTC",
  }));

  const todayCount = countToday(handled, now);
  const avgPickup = avgPickupSeconds(handled, now);
  const talkTime = sumTodayDurationSeconds(handled, now);

  const recent = handled.slice(0, 5);

  return (
    <div className="flex items-stretch gap-4">
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex min-h-[13rem] flex-col gap-3">
          <Card className="relative gap-1 p-5">
            <span className="absolute right-5 top-5">
              <LineBeacon />
            </span>
            <GreetingLine firstName={firstName} />
            <p className="text-sm text-text-muted">Covering {covered.length} properties</p>
          </Card>
          <div className="flex flex-1 gap-3">
            <StatTile value={todayCount} label="Today" />
            <StatTile value={formatDuration(avgPickup)} label="Avg pickup" />
            <StatTile value={formatDuration(talkTime)} label="Talk time" />
          </div>
        </div>
        <Card className="flex-1 gap-2 p-5">
          <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Recent calls
          </h2>
          {recent.length === 0 ? (
            <EmptyState
              icon={Phone}
              title={copy.empty.agentCalls.title}
              description={copy.empty.agentCalls.description}
              className="py-8"
            />
          ) : (
            <ul className="flex flex-col">
              {recent.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"
                >
                  <span className="text-foreground">
                    {c.room_number ? `Room ${c.room_number}` : "Lobby"} · {c.propertyName}
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    {formatTimeOnly(c.ring_started_at, c.timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
