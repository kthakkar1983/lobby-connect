// Pure helpers for the /audit viewer. The filter object carries more than the
// v1 UI exposes (date range, entity, actor) so richer filtering is a UI-only
// add later — no data-layer change. Actor names use the established 2-query
// merge (audit_logs.actor_user_id -> profiles, joined client-side).

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 500;

export type AuditFilter = {
  action: string | null;
  entityType: string | null;
  from: string | null;
  to: string | null;
  limit: number;
};

export function validateAuditFilter(params: {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: string;
}): AuditFilter {
  const limit = Math.min(
    Math.max(Number(params.limit) || AUDIT_DEFAULT_LIMIT, AUDIT_DEFAULT_LIMIT),
    AUDIT_MAX_LIMIT,
  );
  return {
    action: params.action?.trim() || null,
    entityType: params.entityType?.trim() || null,
    from: params.from?.trim() || null,
    to: params.to?.trim() || null,
    limit,
  };
}

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};

export function mergeActorNames(
  rows: AuditRow[],
  profiles: { id: string; full_name: string }[],
): (AuditRow & { actorName: string })[] {
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    ...r,
    actorName:
      r.actor_type === "SYSTEM" || !r.actor_user_id
        ? "System"
        : (nameById.get(r.actor_user_id) ?? "Unknown"),
  }));
}
