import Link from "next/link";
import { Building2, ChevronRight, Siren } from "lucide-react";
import type { ProfileStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { presenceLabel, presenceDotClass } from "@/lib/owner/format";
import { countTodayCalls, countOpenIncidents } from "@/lib/owner/summary";
import { AutoRefresh } from "@/components/owner/auto-refresh";

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

  // Active assignments → agent presence (2-query pattern).
  const agentByProperty = new Map<string, { full_name: string; status: ProfileStatus }>();
  if (propIds.length > 0) {
    const { data: assignments } = await supabase
      .from("property_assignments")
      .select("property_id, primary_agent_id")
      .in("property_id", propIds)
      .is("effective_until", null);

    const agentIds = [...new Set((assignments ?? []).map((a) => a.primary_agent_id))];
    const agentMap = new Map<string, { full_name: string; status: ProfileStatus }>();
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("profiles")
        .select("id, full_name, status")
        .in("id", agentIds);
      for (const a of agents ?? []) agentMap.set(a.id, { full_name: a.full_name, status: a.status });
    }
    for (const a of assignments ?? []) {
      const agent = agentMap.get(a.primary_agent_id);
      if (agent) agentByProperty.set(a.property_id, agent);
    }
  }

  // Recent calls (48h window covers any tz day boundary) + open incidents.
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentCalls } = propIds.length
    ? await supabase
        .from("calls")
        .select("property_id, ring_started_at")
        .in("property_id", propIds)
        .gte("ring_started_at", since)
    : { data: [] };
  const { data: openIncidents } = propIds.length
    ? await supabase
        .from("incidents")
        .select("property_id, status")
        .in("property_id", propIds)
        .neq("status", "RESOLVED")
    : { data: [] };

  const cards = props.map((p) => {
    const agent = agentByProperty.get(p.id) ?? null;
    const todayCount = countTodayCalls(
      (recentCalls ?? []).filter((c) => c.property_id === p.id),
      p.timezone,
      now,
    );
    const openCount = countOpenIncidents(
      (openIncidents ?? []).filter((i) => i.property_id === p.id),
    );
    return { id: p.id, name: p.name, agent, todayCount, openCount };
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Home</h1>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Building2 className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No properties assigned to you yet.</p>
        </div>
      ) : (
        cards.map((c) => (
          <Link
            key={c.id}
            href={`/owner/properties/${c.id}` as never}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-col gap-2">
              <span className="text-lg font-medium text-foreground">{c.name}</span>
              {c.agent ? (
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <span
                    className={cn("h-2 w-2 rounded-full", presenceDotClass(c.agent.status))}
                    aria-hidden="true"
                  />
                  {c.agent.full_name} · {presenceLabel(c.agent.status)}
                </span>
              ) : (
                <span className="text-sm text-text-muted">No agent assigned</span>
              )}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-text-muted">
                  {c.todayCount} call{c.todayCount === 1 ? "" : "s"} today
                </span>
                {c.openCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <Siren className="h-3 w-3" aria-hidden="true" />
                    {c.openCount} open
                  </Badge>
                )}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-text-muted" aria-hidden="true" />
          </Link>
        ))
      )}
    </div>
  );
}
