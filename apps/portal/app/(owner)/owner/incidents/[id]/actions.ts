"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { validateResolutionNote } from "@/lib/owner/incidents";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function resolveIncidentAction(
  incidentId: string,
  note?: string,
): Promise<ActionResult> {
  const actor = await requireRole("OWNER");

  const noteError = validateResolutionNote(note);
  if (noteError) return { ok: false, error: noteError };

  const supabase = await createServerClient();

  // RLS scopes this to the owner's own incidents; a foreign id returns no row.
  const { data: current } = await supabase
    .from("incidents")
    .select("id, status")
    .eq("id", incidentId)
    .maybeSingle();

  if (!current) return { ok: false, error: "Incident not found." };
  if (current.status === "RESOLVED") return { ok: true }; // already final

  const trimmed = note?.trim();
  const { error } = await supabase
    .from("incidents")
    .update({
      status: "RESOLVED",
      resolved_at: new Date().toISOString(),
      resolution_note: trimmed && trimmed.length > 0 ? trimmed : null,
    })
    .eq("id", incidentId);

  if (error) {
    return { ok: false, error: "Couldn't resolve — please refresh and try again." };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.INCIDENT_RESOLVED,
    entityType: "incident",
    entityId: incidentId,
    details: { note_present: Boolean(trimmed && trimmed.length > 0) },
  });

  revalidatePath(`/owner/incidents/${incidentId}`);
  revalidatePath("/owner");
  return { ok: true };
}
