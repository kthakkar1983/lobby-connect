// Audit-log writers. Always use the service-role client — `audit_logs` is
// INSERT-only for service role per the RLS matrix (spec §6.2). The actor's
// operator_id is resolved from `profiles` so we never trust caller input
// for tenancy scoping.

import "server-only";
import type { Json } from "@lc/shared";
import { createAdminClient } from "@/lib/supabase/admin";

/** Audit detail payloads are always a JSON object (never a bare scalar/array). */
export type AuditDetails = { [key: string]: Json };

export type AuditEvent = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: AuditDetails;
};

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const admin = createAdminClient();

  const { data: actor } = await admin
    .from("profiles")
    .select("operator_id")
    .eq("id", event.actorUserId)
    .maybeSingle();

  if (!actor) {
    // No profile means we cannot scope the row to an operator. Skip rather
    // than insert an orphaned audit row. The caller's main action already
    // succeeded; audit is best-effort.
    return;
  }

  await admin.from("audit_logs").insert({
    operator_id: actor.operator_id,
    actor_user_id: event.actorUserId,
    actor_type: "USER",
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    details: event.details ?? null,
  });
}

export async function logSignIn(userId: string): Promise<void> {
  await logAuditEvent({
    actorUserId: userId,
    action: "user.signed_in",
    entityType: "user",
    entityId: userId,
  });
}

export async function logSignOut(userId: string): Promise<void> {
  await logAuditEvent({
    actorUserId: userId,
    action: "user.signed_out",
    entityType: "user",
    entityId: userId,
  });
}
