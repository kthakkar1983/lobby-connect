"use server";

import { revalidatePath } from "next/cache";
import type { Database, Json } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  KIOSK_FIELDS,
  validateKioskFields,
  type KioskContentInput,
} from "@/lib/owner/kiosk";

type PropertyUpdate = Database["public"]["Tables"]["properties"]["Update"];

export type ActionResult = { ok: true } | { ok: false; error: string };

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function updateKioskContentAction(
  propertyId: string,
  input: KioskContentInput,
): Promise<ActionResult> {
  const actor = await requireRole("OWNER");

  const validationError = validateKioskFields(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  // RLS scopes this read to the owner's own properties; a foreign id returns no row.
  const { data: current } = await supabase
    .from("properties")
    .select(KIOSK_FIELDS.join(", "))
    .eq("id", propertyId)
    .maybeSingle<Record<(typeof KIOSK_FIELDS)[number], string | null>>();

  if (!current) return { ok: false, error: "Property not found." };

  const updates: PropertyUpdate = {};
  const audits: Array<{ field: string; from: string | null; to: string | null }> =
    [];

  for (const field of KIOSK_FIELDS) {
    const next = emptyToNull(input[field]);
    if (next !== current[field]) {
      (updates as Record<string, unknown>)[field] = next;
      audits.push({ field, from: current[field], to: next });
    }
  }

  if (audits.length === 0) return { ok: true };

  const { error } = await supabase
    .from("properties")
    .update(updates)
    .eq("id", propertyId);

  if (error) {
    return { ok: false, error: "Couldn't save — please refresh and try again." };
  }

  for (const a of audits) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: "property.kiosk_edited",
      entityType: "property",
      entityId: propertyId,
      details: a as unknown as Json,
    });
  }

  revalidatePath(`/owner/properties/${propertyId}`);
  return { ok: true };
}
