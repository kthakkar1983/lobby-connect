import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { createPlaybookSignedUrl } from "@/lib/storage/playbook";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // OWNER is rejected: the in-call playbook reference is for agents/admins only.
  // Owners access playbooks via /api/owner/properties/[id]/playbook instead.
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const call = await fetchOperatorCall<{
    id: string;
    property_id: string;
    operator_id: string;
  }>(actor, id, "id, property_id");
  if (call instanceof NextResponse) return call;

  const admin = createAdminClient();

  const { data: property } = await admin
    .from("properties")
    .select("playbook_pdf_url, playbook_version")
    .eq("id", call.property_id)
    .maybeSingle();

  if (!property?.playbook_pdf_url) {
    return NextResponse.json({ hasPlaybook: false });
  }

  const signedUrl = await createPlaybookSignedUrl(
    admin,
    property.playbook_pdf_url as string,
  );
  if (!signedUrl) {
    return NextResponse.json({ error: "Could not generate playbook URL" }, { status: 500 });
  }

  return NextResponse.json({
    hasPlaybook: true,
    signedUrl,
    version: property.playbook_version,
  });
}
