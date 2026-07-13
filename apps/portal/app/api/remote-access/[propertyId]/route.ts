import { NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { requireOnDuty } from "@/lib/shifts/gate";

// The only route that returns a long-lived secret — never cacheable anywhere.
const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const admin = createAdminClient();
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;
  // Connect acts as a heartbeat so a long remote session doesn't lapse the shift.
  // Log a failure: this write is the backstop for the throttled-heartbeat bug
  // (task_71d65b0a), so a silent failure defeats its whole purpose.
  const { error: keepAliveError } = await admin
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE");
  if (keepAliveError) {
    console.error("[remote-access] keep-alive last_seen_at refresh failed", keepAliveError);
  }

  const { propertyId } = await params;
  const trigger =
    new URL(request.url).searchParams.get("trigger") === "prewarm" ? "prewarm" : "connect";

  const { data: row } = await admin
    .from("property_remote_access")
    .select("peer_id, unattended_password, operator_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  // Operator scoping (the v2 per-property tightening rides the existing seam).
  if (!row || row.operator_id !== actor.operatorId) {
    return NextResponse.json(
      { error: "No remote access configured" },
      { status: 404, headers: NO_STORE },
    );
  }
  // D14: issuance IS the security event (audit-on-secret-read — deliberately the
  // codebase's first audited GET; a cache-hit Connect emits no extra row).
  await logAuditEvent({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.REMOTE_ACCESS_CREDENTIALS_ISSUED,
    entityType: "property",
    entityId: propertyId,
    details: { peer_id: row.peer_id, trigger },
  });
  return NextResponse.json(
    { peerId: row.peer_id, password: row.unattended_password },
    { headers: NO_STORE },
  );
}
