import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for a single call

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, operator_id")
    .eq("id", id)
    .maybeSingle();
  if (!call || call.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

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
