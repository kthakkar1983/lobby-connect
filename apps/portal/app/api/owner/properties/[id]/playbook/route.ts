import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { validatePlaybookFile, playbookStorageKey } from "@/lib/owner/playbook";

export const runtime = "nodejs";

const SIGNED_URL_TTL = 3600; // 1 hour

type Ctx = { params: Promise<{ id: string }> };

// Resolves the authenticated OWNER + their owned property, or a NextResponse error.
async function resolveOwnerProperty(propertyId: string) {
  const actor = await requireApiActor({ allow: ["OWNER"] });
  if (actor instanceof NextResponse) return { error: actor };

  const admin = createAdminClient();

  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, owner_user_id, playbook_pdf_url, playbook_version")
    .eq("id", propertyId)
    .maybeSingle();

  if (
    !property ||
    property.operator_id !== actor.operatorId ||
    property.owner_user_id !== actor.userId
  ) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { admin, actor, property };
}

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveOwnerProperty(id);
  if ("error" in resolved) return resolved.error;
  const { admin, property } = resolved;

  if (!property.playbook_pdf_url) {
    return NextResponse.json({ hasPlaybook: false });
  }

  const { data: signed, error } = await admin.storage
    .from("playbooks")
    .createSignedUrl(property.playbook_pdf_url as string, SIGNED_URL_TTL);

  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: "Could not generate playbook URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    hasPlaybook: true,
    signedUrl: signed.signedUrl,
    version: property.playbook_version,
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveOwnerProperty(id);
  if ("error" in resolved) return resolved.error;
  const { admin, actor, property } = resolved;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const fileError = validatePlaybookFile({ type: file.type, size: file.size });
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const key = playbookStorageKey(property.operator_id as string, property.id as string);
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from("playbooks")
    .upload(key, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const nextVersion = ((property.playbook_version as number | null) ?? 0) + 1;
  const { error: updateError } = await admin
    .from("properties")
    .update({ playbook_pdf_url: key, playbook_version: nextVersion })
    .eq("id", property.id as string);
  if (updateError) {
    return NextResponse.json({ error: "Could not save playbook." }, { status: 500 });
  }

  await logAuditEvent({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.PROPERTY_PLAYBOOK_UPLOADED,
    entityType: "property",
    entityId: property.id as string,
    details: { version: nextVersion },
  });

  return NextResponse.json({ ok: true, version: nextVersion });
}
