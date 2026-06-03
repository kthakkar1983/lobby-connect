import Link from "next/link";
import { Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  incidentStatusLabel,
  incidentStatusBadgeVariant,
  formatCallTime,
} from "@/lib/owner/format";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function OwnerIncidentsPage() {
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id);
  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));

  const { data: incidents } = props.length
    ? await supabase
        .from("incidents")
        .select("id, property_id, status, dispatched_to, call_id, created_at")
        .in(
          "property_id",
          props.map((p) => p.id),
        )
        .order("created_at", { ascending: false })
    : { data: [] };
  const rows = incidents ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Siren className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No emergencies.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((i) => (
            <li key={i.id}>
              <Link
                href={`/owner/incidents/${i.id}` as never}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Siren
                      className="h-4 w-4 text-destructive"
                      aria-hidden="true"
                    />
                    911 Emergency
                  </span>
                  <span className="text-xs text-text-muted">
                    {nameById.get(i.property_id) ?? "—"} &middot;{" "}
                    {formatCallTime(
                      i.created_at,
                      tzById.get(i.property_id) ?? "UTC",
                    )}{" "}
                    &middot; dispatched to {i.dispatched_to}
                  </span>
                </div>
                <Badge variant={incidentStatusBadgeVariant(i.status)}>
                  {incidentStatusLabel(i.status)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
