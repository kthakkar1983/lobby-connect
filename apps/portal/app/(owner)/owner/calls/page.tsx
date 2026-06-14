import Link from "next/link";
import { Phone } from "lucide-react";
import type { Route } from "next";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CallRow, type CallRowData } from "@/components/owner/call-row";
import { dayGroupLabel } from "@/lib/owner/summary";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
import type { CallChannel } from "@lc/shared";
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";

const PAGE_SIZE = 50;

export default async function OwnerCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; before?: string; channel?: string }>;
}) {
  const { property, before, channel: channelParam } = await searchParams;
  const cursor = decodeCursor(before);
  const activeChannel: CallChannel | null =
    channelParam === "AUDIO" || channelParam === "VIDEO" ? channelParam : null;
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id)
    .order("name");

  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const multiProperty = props.length > 1;
  const activeProperty = property && tzById.has(property) ? property : null;

  const propIds = props.map((p) => p.id);

  let callsQuery = supabase
    .from("calls")
    .select(
      "id, created_at, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number, caller_number, notes, recording_url",
    )
    // created_at is index-backed and monotonic with ring_started_at at insert.
    // id tiebreaker gives a stable total order for keyset pagination.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) callsQuery = callsQuery.or(keysetOrFilter(cursor));

  if (activeProperty) {
    callsQuery = callsQuery.eq("property_id", activeProperty);
  } else if (propIds.length > 0) {
    callsQuery = callsQuery.in("property_id", propIds);
  } else {
    // Owner has no properties — skip the query.
    callsQuery = callsQuery.in("property_id", []);
  }

  if (activeChannel) {
    callsQuery = callsQuery.eq("channel", activeChannel);
  }

  const { data: calls } = await callsQuery;
  const rows = calls ?? [];

  // Handler names — 2-query pattern.
  const handlerIds = [
    ...new Set(
      rows
        .map((c) => c.handled_by_user_id)
        .filter((x): x is string => !!x),
    ),
  ];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  // Incident existence per call — one batched query → Map<call_id, incidentId>.
  const incidentByCall = new Map<string, string>();
  const callIds = rows.map((c) => c.id);
  if (callIds.length > 0) {
    const { data: incidents } = await supabase
      .from("incidents")
      .select("id, call_id")
      .in("call_id", callIds);
    for (const inc of incidents ?? []) {
      if (inc.call_id) incidentByCall.set(inc.call_id, inc.id);
    }
  }

  const buildHref = (next: { property?: string | null; channel?: CallChannel | null; before?: string | null }) => {
    const sp = new URLSearchParams();
    const p = next.property === undefined ? activeProperty : next.property;
    const ch = next.channel === undefined ? activeChannel : next.channel;
    if (p) sp.set("property", p);
    if (ch) sp.set("channel", ch);
    if (next.before) sp.set("before", next.before);
    const qs = sp.toString();
    return `/owner/calls${qs ? `?${qs}` : ""}`;
  };
  const lastRow = rows[rows.length - 1];
  const olderHref = lastRow ? buildHref({ before: encodeCursor({ created_at: lastRow.created_at, id: lastRow.id }) }) : null;
  const newestHref = buildHref({ before: null });

  const now = new Date();
  // Build display rows + group them by day label (rows already sorted desc).
  const grouped: { label: string; items: CallRowData[] }[] = [];
  for (const c of rows) {
    const tz = tzById.get(c.property_id) ?? "UTC";
    const label = dayGroupLabel(c.ring_started_at, tz, now);
    const secondary = [
      multiProperty ? (nameById.get(c.property_id) ?? "—") : null,
      c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
      c.room_number ? `Room ${c.room_number}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const item: CallRowData = {
      secondary,
      detail: {
        id: c.id,
        channel: c.channel,
        state: c.state,
        caller_number: c.caller_number,
        room_number: c.room_number,
        ring_started_at: c.ring_started_at,
        duration_seconds: c.duration_seconds,
        notes: c.notes,
        recording_url: c.recording_url,
        propertyName: nameById.get(c.property_id) ?? "—",
        timeZone: tz,
        handlerName: c.handled_by_user_id
          ? (handlerName.get(c.handled_by_user_id) ?? "—")
          : "Unanswered",
        incidentId: incidentByCall.get(c.id) ?? null,
      },
    };
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(item);
    else grouped.push({ label, items: [item] });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="font-display text-3xl text-foreground">Calls</h1>

      {multiProperty && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHref({ property: null }) as Route}
            className={cn(
              "rounded-pill border px-3 py-1 text-sm",
              !activeProperty ? "border-accent-strong bg-accent/10 text-accent-text" : "border-border text-text-muted",
            )}
          >
            All
          </Link>
          {props.map((p) => (
            <Link
              key={p.id}
              href={buildHref({ property: p.id }) as Route}
              className={cn(
                "rounded-pill border px-3 py-1 text-sm",
                activeProperty === p.id
                  ? "border-accent-strong bg-accent/10 text-accent-text"
                  : "border-border text-text-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            { label: "All", value: null },
            { label: "Phone", value: "AUDIO" as const },
            { label: "Video", value: "VIDEO" as const },
          ] as const
        ).map((opt) => (
          <Link
            key={opt.label}
            href={buildHref({ channel: opt.value }) as Route}
            className={cn(
              "rounded-pill border px-3 py-1 text-sm",
              activeChannel === opt.value
                ? "border-accent-strong bg-accent/10 text-accent-text"
                : "border-border text-text-muted",
            )}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Phone}
            title={copy.empty.ownerCalls.title}
            description={copy.empty.ownerCalls.description}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <h2 className="font-label text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                {g.label}
              </h2>
              {g.items.map((item) => (
                <CallRow key={item.detail.id} call={item} />
              ))}
            </div>
          ))}
        </div>
      )}

      <nav aria-label="Call history pages" className="flex items-center justify-between">
        {cursor ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={newestHref as Route} aria-label="Go to newest calls">← Newest</Link>
          </Button>
        ) : <span />}
        {rows.length === PAGE_SIZE && olderHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={olderHref as Route} aria-label="Go to older calls">Older →</Link>
          </Button>
        ) : <span />}
      </nav>
    </div>
  );
}
