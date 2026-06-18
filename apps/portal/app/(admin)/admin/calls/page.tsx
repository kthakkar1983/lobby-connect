import { Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { CallRow, type CallRowData } from "@/components/call/call-row";
import { CallFilters } from "@/components/call/call-filters";
import { dayGroupLabel } from "@/lib/owner/summary";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import type { CallChannel } from "@lc/shared";
import { parseOutcome, statesForOutcome, buildCallsHref } from "@/lib/calls/filters";
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";
import type { Route } from "next";
import Link from "next/link";

const PAGE_SIZE = 50;

export default async function AdminCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; before?: string; channel?: string; outcome?: string }>;
}) {
  const { property, before, channel: channelParam, outcome: outcomeParam } = await searchParams;
  const cursor = decodeCursor(before);
  const activeChannel: CallChannel | null = channelParam === "AUDIO" || channelParam === "VIDEO" ? channelParam : null;
  const activeOutcome = parseOutcome(outcomeParam);
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties").select("id, name, timezone")
    .eq("operator_id", actor.operator_id).order("name");
  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const activeProperty = property && tzById.has(property) ? property : null;

  let q = supabase
    .from("calls")
    .select("id, created_at, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number, caller_number, notes, recording_url")
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
  if (cursor) q = q.or(keysetOrFilter(cursor));
  if (activeProperty) q = q.eq("property_id", activeProperty);
  if (activeChannel) q = q.eq("channel", activeChannel);
  if (activeOutcome) q = q.in("state", statesForOutcome(activeOutcome));

  const { data: calls } = await q;
  const rows = calls ?? [];

  const handlerIds = [...new Set(rows.map((c) => c.handled_by_user_id).filter((x): x is string => !!x))];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  const now = new Date();
  const grouped: { label: string; items: CallRowData[] }[] = [];
  for (const c of rows) {
    const tz = tzById.get(c.property_id) ?? "UTC";
    const label = dayGroupLabel(c.ring_started_at, tz, now);
    const item: CallRowData = {
      secondary: [
        nameById.get(c.property_id) ?? "—",
        c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
        c.room_number ? `Room ${c.room_number}` : null,
      ].filter(Boolean).join(" · "),
      detail: {
        id: c.id, channel: c.channel, state: c.state, caller_number: c.caller_number, room_number: c.room_number,
        ring_started_at: c.ring_started_at, duration_seconds: c.duration_seconds, notes: c.notes, recording_url: c.recording_url,
        propertyName: nameById.get(c.property_id) ?? "—", timeZone: tz,
        handlerName: c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
      },
      // no incidentHref — admins have no incident route
    };
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(item);
    else grouped.push({ label, items: [item] });
  }

  const lastRow = rows[rows.length - 1];
  const olderHref = lastRow ? buildCallsHref("/admin/calls", { property: activeProperty, channel: activeChannel, outcome: activeOutcome, before: encodeCursor({ created_at: lastRow.created_at, id: lastRow.id }) }) : null;
  const newestHref = buildCallsHref("/admin/calls", { property: activeProperty, channel: activeChannel, outcome: activeOutcome });

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="text-2xl font-semibold text-foreground">Calls</h1>
      <CallFilters basePath="/admin/calls" properties={props} activeProperty={activeProperty} activeChannel={activeChannel} activeOutcome={activeOutcome} />

      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon={Phone} title="No calls match" description="Try a different filter, or check back as the shift runs." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <h2 className="font-label text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">{g.label}</h2>
              {g.items.map((item) => <CallRow key={item.detail.id} call={item} />)}
            </div>
          ))}
        </div>
      )}

      <nav aria-label="Call history pages" className="flex items-center justify-between">
        {cursor ? <Button asChild variant="ghost" size="sm"><Link href={newestHref as Route} aria-label="Go to newest calls">← Newest</Link></Button> : <span />}
        {rows.length === PAGE_SIZE && olderHref ? <Button asChild variant="outline" size="sm"><Link href={olderHref as Route} aria-label="Go to older calls">Older →</Link></Button> : <span />}
      </nav>
    </div>
  );
}
