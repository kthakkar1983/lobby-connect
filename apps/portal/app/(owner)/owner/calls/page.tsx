import Link from "next/link";
import { Phone, Video } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  callStateLabel,
  callStateBadgeVariant,
  formatCallTime,
  formatDuration,
} from "@/lib/owner/format";
import { AutoRefresh } from "@/components/owner/auto-refresh";

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
    .order("ring_started_at", { ascending: false })
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Calls</h1>

      {multiProperty && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={"/owner/calls" as never}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              !activeProperty
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-text-muted",
            )}
          >
            All
          </Link>
          {props.map((p) => (
            <Link
              key={p.id}
              href={`/owner/calls?property=${p.id}` as never}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                activeProperty === p.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-text-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Phone className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No calls yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/owner/calls/${c.id}` as never}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {c.channel === "VIDEO" ? (
                      <Video className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Phone className="h-4 w-4" aria-hidden="true" />
                    )}
                    {formatCallTime(
                      c.ring_started_at,
                      tzById.get(c.property_id) ?? "UTC",
                    )}
                  </span>
                  <span className="text-xs text-text-muted">
                    {multiProperty
                      ? `${nameById.get(c.property_id) ?? "—"} · `
                      : ""}
                    {c.handled_by_user_id
                      ? (handlerName.get(c.handled_by_user_id) ?? "—")
                      : "Unanswered"}
                    {c.room_number ? ` · Room ${c.room_number}` : ""}
                    {` · ${formatDuration(c.duration_seconds)}`}
                  </span>
                </div>
                <Badge variant={callStateBadgeVariant(c.state)}>
                  {callStateLabel(c.state)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length === limit && (
        <Link
          href={moreHref as never}
          className="self-center text-sm text-primary hover:underline"
        >
          Load more
        </Link>
      )}
    </div>
  );
}
