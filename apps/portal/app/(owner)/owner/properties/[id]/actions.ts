"use server";

import { revalidatePath } from "next/cache";
import type { Database } from "@lc/shared";
import type { AuditDetails } from "@/lib/auth/audit";
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import {
  KIOSK_FIELDS,
  validateKioskFields,
  validateCtaStyle,
  type KioskContentInput,
  type KioskCtaStyle,
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
  ctaStyle: KioskCtaStyle,
): Promise<ActionResult> {
  const actor = await requireRole("OWNER");

  const validationError = validateKioskFields(input);
  if (validationError) return { ok: false, error: validationError };

  const styleError = validateCtaStyle(ctaStyle);
  if (styleError) return { ok: false, error: styleError };

  const supabase = await createServerClient();

  // RLS scopes this read to the owner's own properties; a foreign id returns no row.
  const { data: current } = await supabase
    .from("properties")
    .select([...KIOSK_FIELDS, "kiosk_cta_style"].join(", "))
    .eq("id", propertyId)
    .maybeSingle<
      Record<(typeof KIOSK_FIELDS)[number], string | null> & {
        kiosk_cta_style: string | null;
      }
    >();

  if (!current) return { ok: false, error: "Property not found." };

  const updates: PropertyUpdate = {};
  const audits: AuditDetails[] = [];

  for (const field of KIOSK_FIELDS) {
    const next = emptyToNull(input[field]);
    if (next !== current[field]) {
      (updates as Record<string, unknown>)[field] = next;
      audits.push({ field, from: current[field], to: next });
    }
  }

  if (ctaStyle !== current.kiosk_cta_style) {
    (updates as Record<string, unknown>).kiosk_cta_style = ctaStyle;
    audits.push({ field: "kiosk_cta_style", from: current.kiosk_cta_style, to: ctaStyle });
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
      action: AUDIT_ACTIONS.PROPERTY_KIOSK_EDITED,
      entityType: "property",
      entityId: propertyId,
      details: a,
    });
  }

  revalidatePath(`/owner/properties/${propertyId}`);
  return { ok: true };
}
