import { Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { IncidentRow } from "@/components/owner/incident-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
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
      <h1 className="font-display text-3xl text-foreground">Incidents</h1>

      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Siren}
            title={copy.empty.ownerIncidents.title}
            description={copy.empty.ownerIncidents.description}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((i) => (
            <IncidentRow
              key={i.id}
              incident={{
                id: i.id,
                status: i.status,
                dispatched_to: i.dispatched_to,
                created_at: i.created_at,
                propertyName: nameById.get(i.property_id) ?? "—",
                timeZone: tzById.get(i.property_id) ?? "UTC",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
