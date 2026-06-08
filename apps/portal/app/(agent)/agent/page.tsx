import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { LineBeacon } from "@/components/dashboard/line-beacon";
import { countToday, avgPickupSeconds } from "@/lib/dashboard/calls";
import { formatDuration, formatTimeOnly } from "@/lib/owner/format";

export default async function AgentDashboardPage() {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();
  const now = new Date();

  // Fetch full_name separately — requireRole returns id/role/operator_id/active/must_change_password only
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", actor.id)
    .maybeSingle();

  const fullName = profile?.full_name ?? "Agent";
  const firstName = fullName.split(/\s+/)[0] ?? fullName;

  // Active assignments for this agent — 2-query pattern (no FK Relationships defined)
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id")
    .eq("primary_agent_id", actor.id)
    .is("effective_until", null);

  const coveredIds = (assignments ?? []).map((a) => a.property_id);

  let covered: Array<{ id: string; name: string; timeZone: string }> = [];
  const tzById = new Map<string, string>();
  if (coveredIds.length > 0) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, name, timezone")
      .in("id", coveredIds);
    covered = (props ?? []).map((p) => ({ id: p.id, name: p.name, timeZone: p.timezone }));
    for (const p of covered) tzById.set(p.id, p.timeZone);
  }

  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();

  // Calls handled by this agent in the last 48h
  const { data: handledRaw } = await supabase
    .from("calls")
    .select("id, property_id, ring_started_at, answered_at, room_number")
    .eq("handled_by_user_id", actor.id)
    .gte("ring_started_at", since)
    .order("ring_started_at", { ascending: false });

  // Merge property name/tz by id
  const nameById = new Map(covered.map((c) => [c.id, c.name]));

  const handled = (handledRaw ?? []).map((c) => ({
    id: c.id,
    ring_started_at: c.ring_started_at,
    answered_at: c.answered_at,
    room_number: c.room_number,
    propertyName: nameById.get(c.property_id) ?? "—",
    timeZone: tzById.get(c.property_id) ?? "UTC",
  }));

  const todayCount = countToday(handled, now);
  const avgPickup = avgPickupSeconds(handled, now);

  // Missed calls (NO_ANSWER) on covered properties today
  let missed = 0;
  if (coveredIds.length > 0) {
    const { data: noAns } = await supabase
      .from("calls")
      .select("property_id, ring_started_at")
      .in("property_id", coveredIds)
      .eq("state", "NO_ANSWER")
      .gte("ring_started_at", since);
    missed = countToday(
      (noAns ?? []).map((c) => ({
        ring_started_at: c.ring_started_at,
        timeZone: tzById.get(c.property_id) ?? "UTC",
      })),
      now,
    );
  }

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
            <StatTile value={missed} label="Missed" alert={missed > 0} />
          </div>
        </div>
        <Card className="flex-1 gap-2 p-5">
          <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Recent calls
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">No calls handled yet.</p>
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
