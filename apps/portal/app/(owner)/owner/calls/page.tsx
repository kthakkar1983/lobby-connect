import Link from "next/link";
import { Phone } from "lucide-react";
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

const DEFAULT_LIMIT = 50;

export default async function OwnerCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; limit?: string }>;
}) {
  const { property, limit: limitParam } = await searchParams;
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
  const limit = Math.min(
    Math.max(Number(limitParam) || DEFAULT_LIMIT, DEFAULT_LIMIT),
    500,
  );

  const propIds = props.map((p) => p.id);

  let callsQuery = supabase
    .from("calls")
    .select(
      "id, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number",
    )
    // created_at is index-backed and monotonic with ring_started_at at insert.
    .order("created_at", { ascending: false })
    .limit(limit);

  if (activeProperty) {
    callsQuery = callsQuery.eq("property_id", activeProperty);
  } else if (propIds.length > 0) {
    callsQuery = callsQuery.in("property_id", propIds);
  } else {
    // Owner has no properties — skip the query.
    callsQuery = callsQuery.in("property_id", []);
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

  const moreHref = (() => {
    const sp = new URLSearchParams();
    if (activeProperty) sp.set("property", activeProperty);
    sp.set("limit", String(limit + DEFAULT_LIMIT));
    return `/owner/calls?${sp.toString()}`;
  })();

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
      id: c.id,
      channel: c.channel,
      state: c.state,
      ring_started_at: c.ring_started_at,
      duration_seconds: c.duration_seconds,
      timeZone: tz,
      secondary,
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
            href={"/owner/calls" as never}
            className={cn(
              "rounded-pill border px-3 py-1 text-sm",
              !activeProperty ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border text-text-muted",
            )}
          >
            All
          </Link>
          {props.map((p) => (
            <Link
              key={p.id}
              href={`/owner/calls?property=${p.id}` as never}
              className={cn(
                "rounded-pill border px-3 py-1 text-sm",
                activeProperty === p.id
                  ? "border-accent-strong bg-accent/10 text-accent-strong"
                  : "border-border text-text-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

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
                <CallRow key={item.id} call={item} />
              ))}
            </div>
          ))}
        </div>
      )}

      {rows.length === limit && (
        <Button asChild variant="outline" className="self-center">
          <Link href={moreHref as never}>Load more</Link>
        </Button>
      )}
    </div>
  );
}
