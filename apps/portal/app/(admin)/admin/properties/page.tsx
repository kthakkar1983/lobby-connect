import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { PropertiesTable } from "./properties-table";

export default async function PropertiesPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, name, timezone, routing_did, active, created_at, owner_user_id")
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load properties: ${error.message}`);
  }

  const ownerIds = [
    ...new Set(
      (properties ?? [])
        .map((p) => p.owner_user_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    for (const o of owners ?? []) ownerNames.set(o.id, o.full_name);
  }

  const rows = (properties ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    timezone: p.timezone,
    routing_did: p.routing_did,
    active: p.active,
    owner_name: p.owner_user_id
      ? (ownerNames.get(p.owner_user_id) ?? "—")
      : "—",
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Properties</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage the hotels and venues your operator serves.
          </p>
        </div>
      </header>

      <PropertiesTable properties={rows} />
    </div>
  );
}
