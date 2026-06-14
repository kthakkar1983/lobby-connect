import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import {
  validateAuditFilter,
  mergeActorNames,
  type AuditRow,
} from "@/lib/audit/query";
import { KNOWN_ACTIONS } from "@/lib/audit/actions";
import { AuditTable } from "./audit-table";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requireRole("ADMIN");
  const filter = validateAuditFilter(sp);
  const supabase = await createServerClient();

  let q = supabase
    .from("audit_logs")
    .select(
      "id, actor_user_id, actor_type, action, entity_type, entity_id, details, created_at",
    )
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false })
    .limit(filter.limit);

  if (filter.action) q = q.eq("action", filter.action);
  if (filter.entityType) q = q.eq("entity_type", filter.entityType);
  if (filter.from) q = q.gte("created_at", filter.from);
  if (filter.to) q = q.lte("created_at", filter.to);

  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];

  const actorIds = [
    ...new Set(rows.map((r) => r.actor_user_id).filter((x): x is string => !!x)),
  ];
  let profiles: { id: string; full_name: string }[] = [];
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    profiles = profs ?? [];
  }

  const merged = mergeActorNames(rows, profiles);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Audit log</h1>
      <AuditTable
        rows={merged}
        actions={KNOWN_ACTIONS}
        activeAction={filter.action}
        limit={filter.limit}
        hasMore={rows.length === filter.limit}
      />
    </div>
  );
}
