import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";

export const runtime = "nodejs";

const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for a single call

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // Behavior-identical rewire: this route had no role gate before, so OWNER stays
  // allowed here. (Adding an OWNER-reject is a deliberate change handled in the
  // dedicated OWNER-reject task, not this behavior-neutral pass.)
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
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

  const { data: signed, error } = await admin.storage
    .from("playbooks")
    .createSignedUrl(property.playbook_pdf_url as string, SIGNED_URL_TTL);

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Could not generate playbook URL" }, { status: 500 });
  }

  return NextResponse.json({
    hasPlaybook: true,
    signedUrl: signed.signedUrl,
    version: property.playbook_version,
  });
}
