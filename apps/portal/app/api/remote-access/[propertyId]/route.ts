import { NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

// The only route that returns a long-lived secret — never cacheable anywhere.
const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const { propertyId } = await params;
  const trigger =
    new URL(request.url).searchParams.get("trigger") === "prewarm" ? "prewarm" : "connect";

  const admin = createAdminClient();
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
