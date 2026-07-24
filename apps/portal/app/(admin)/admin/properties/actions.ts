"use server";

import { revalidatePath } from "next/cache";
import type { Database } from "@lc/shared";
import type { AuditDetails } from "@/lib/auth/audit";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/require-role";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { signKioskToken } from "@/lib/kiosk/config-token";
import {
  validatePropertyName,
  validateTimezone,
  validatePhone,
  validateKioskMessage,
} from "@/lib/properties/validate";
import { validateAgentId } from "@/lib/assignments/validate";
import {
  validatePeerId,
  validateUnattendedPassword,
} from "@/lib/remote-access/validate";
import {
  planAssignmentChange,
  type CurrentAssignment,
} from "@/lib/assignments/plan";
import { diffFields, emptyToNull } from "@/lib/audit/diff";

export type PropertyInput = {
  name: string;
  timezone: string;
  owner_user_id: string | null;
  routing_did: string;
  property_phone_number: string;
  after_hours_support_phone: string;
  kiosk_welcome_message: string;
  kiosk_apology_message: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type PropertyInsert = Database["public"]["Tables"]["properties"]["Insert"];
type PropertyUpdate = Database["public"]["Tables"]["properties"]["Update"];
type AssignmentInsert =
  Database["public"]["Tables"]["property_assignments"]["Insert"];
type AvailabilityInsert =
  Database["public"]["Tables"]["admin_call_availability"]["Insert"];

const ASSIGNABLE_ROLES = ["AGENT", "ADMIN"] as const;

function validatePropertyInput(input: PropertyInput): string | null {
  return (
    validatePropertyName(input.name) ??
    validateTimezone(input.timezone) ??
    validatePhone(input.routing_did) ??
    validatePhone(input.property_phone_number) ??
    validatePhone(input.after_hours_support_phone) ??
    validateKioskMessage(input.kiosk_welcome_message) ??
    validateKioskMessage(input.kiosk_apology_message)
  );
}

// Defense-in-depth beyond the RLS-scoped dropdown: a non-null owner must be an
// existing same-operator profile with role OWNER.
async function assertValidOwner(
  supabase: ServerClient,
  operatorId: string,
  ownerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, operator_id, role")
    .eq("id", ownerId)
    .maybeSingle();

  if (!data || data.operator_id !== operatorId || data.role !== "OWNER") {
    return "Selected owner is not a valid owner in your operator.";
  }
  return null;
}

// Defense-in-depth beyond the RLS-scoped dropdown: the selected primary agent
// must be an active same-operator profile with role AGENT or ADMIN.
async function assertValidAgent(
  supabase: ServerClient,
  operatorId: string,
  agentId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, operator_id, role, active")
    .eq("id", agentId)
    .maybeSingle();

  if (
    !data ||
    data.operator_id !== operatorId ||
    !data.active ||
    !ASSIGNABLE_ROLES.includes(data.role as (typeof ASSIGNABLE_ROLES)[number])
  ) {
    return "Selected agent is not a valid, active agent in your operator.";
  }
  return null;
}

export async function createPropertyAction(
  input: PropertyInput,
): Promise<CreateResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validatePropertyInput(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  if (input.owner_user_id) {
    const ownerError = await assertValidOwner(
      supabase,
      actor.operator_id,
      input.owner_user_id,
    );
    if (ownerError) return { ok: false, error: ownerError };
  }

  const insert: PropertyInsert = {
    operator_id: actor.operator_id,
    name: input.name.trim(),
    timezone: input.timezone,
    owner_user_id: input.owner_user_id,
    active: true,
  };

  // Optional text columns: omit when blank so nullable columns stay null and
  // the kiosk-message columns fall back to their DB defaults.
  const routingDid = emptyToNull(input.routing_did);
  if (routingDid) insert.routing_did = routingDid;
  const propertyPhone = emptyToNull(input.property_phone_number);
  if (propertyPhone) insert.property_phone_number = propertyPhone;
  const afterHours = emptyToNull(input.after_hours_support_phone);
  if (afterHours) insert.after_hours_support_phone = afterHours;
  const welcome = emptyToNull(input.kiosk_welcome_message);
  if (welcome) insert.kiosk_welcome_message = welcome;
  const apology = emptyToNull(input.kiosk_apology_message);
  if (apology) insert.kiosk_apology_message = apology;

  const { data, error } = await supabase
    .from("properties")
    .insert(insert)
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error: "That routing number is already assigned to another property.",
      };
    }
    return {
      ok: false,
      error: `Failed to create property: ${error?.message ?? "unknown error"}`,
    };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.PROPERTY_CREATED,
    entityType: "property",
    entityId: data.id,
    details: {
      name: insert.name,
      timezone: insert.timezone,
      owner_user_id: input.owner_user_id,
    },
  });

  revalidatePath("/admin/properties");
  return { ok: true, id: data.id };
}

export type KioskLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Mint a signed kiosk pairing URL for this property. The token is long-lived
// (no expiry) and carried in the kiosk URL as `?t=`; opening it once pairs the
// tablet to this property. Admin-only; verifies operator ownership via RLS.
export async function generateKioskLinkAction(
  propertyId: string,
): Promise<KioskLinkResult> {
  const actor = await requireRole("ADMIN");

  const secret = process.env.KIOSK_CONFIG_SECRET;
  if (!secret) {
    return { ok: false, error: "Kiosk signing secret is not configured." };
  }
  const base = (process.env.KIOSK_ORIGIN ?? "http://localhost:5173").replace(
    /\/$/,
    "",
  );

  const supabase = await createServerClient();
  // RLS scopes this to the actor's operator; a foreign/unknown id returns null.
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!property) {
    return { ok: false, error: "Property not found." };
  }

  const token = signKioskToken(propertyId, secret);

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.PROPERTY_KIOSK_LINK_GENERATED,
    entityType: "property",
    entityId: propertyId,
  });

  return { ok: true, url: `${base}/?t=${token}` };
}

export async function updatePropertyAction(
  input: PropertyInput & { propertyId: string; active: boolean },
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validatePropertyInput(input);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  if (input.owner_user_id) {
    const ownerError = await assertValidOwner(
      supabase,
      actor.operator_id,
      input.owner_user_id,
    );
    if (ownerError) return { ok: false, error: ownerError };
  }

  // RLS scopes this read to the actor's operator; a foreign / unknown id
  // returns no row.
  const { data: current } = await supabase
    .from("properties")
    .select(
      "id, operator_id, name, timezone, owner_user_id, routing_did, property_phone_number, after_hours_support_phone, kiosk_welcome_message, kiosk_apology_message, active",
    )
    .eq("id", input.propertyId)
    .maybeSingle();

  if (!current) {
    return { ok: false, error: "Property not found in your operator." };
  }

  const next = {
    name: input.name.trim(),
    timezone: input.timezone,
    owner_user_id: input.owner_user_id,
    routing_did: emptyToNull(input.routing_did),
    property_phone_number: emptyToNull(input.property_phone_number),
    after_hours_support_phone: emptyToNull(input.after_hours_support_phone),
    kiosk_welcome_message: emptyToNull(input.kiosk_welcome_message),
    kiosk_apology_message: emptyToNull(input.kiosk_apology_message),
  };

  const updates: PropertyUpdate = {};
  const auditEvents: Array<{ action: string; details: AuditDetails }> = [];

  const TEXT_FIELDS = [
    "name",
    "timezone",
    "owner_user_id",
    "routing_did",
    "property_phone_number",
    "after_hours_support_phone",
    "kiosk_welcome_message",
    "kiosk_apology_message",
  ] as const;

  const { updates: textUpdates, changes } = diffFields(
    current as Record<string, unknown>,
    next as Record<string, unknown>,
    TEXT_FIELDS,
  );
  Object.assign(updates, textUpdates);
  for (const c of changes) {
    auditEvents.push({
      action: AUDIT_ACTIONS.PROPERTY_EDITED,
      details: { field: c.field, from: c.from, to: c.to },
    });
  }

  if (input.active !== current.active) {
    updates.active = input.active;
    auditEvents.push({
      action: AUDIT_ACTIONS.PROPERTY_ACTIVE_TOGGLED,
      details: { from: current.active, to: input.active },
    });
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from("properties")
    .update(updates)
    .eq("id", input.propertyId);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That routing number is already assigned to another property.",
      };
    }
    return { ok: false, error: `Failed to update property: ${error.message}` };
  }

  for (const evt of auditEvents) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: evt.action,
      entityType: "property",
      entityId: input.propertyId,
      details: evt.details,
    });
  }

  revalidatePath("/admin/properties");
  revalidatePath(`/admin/properties/${input.propertyId}`);
  return { ok: true };
}

async function getCurrentAssignment(
  supabase: ServerClient,
  operatorId: string,
  propertyId: string,
): Promise<CurrentAssignment> {
  const { data } = await supabase
    .from("property_assignments")
    .select("id, primary_agent_id")
    .eq("operator_id", operatorId)
    .eq("property_id", propertyId)
    .is("effective_until", null)
    .maybeSingle();
  return data ?? null;
}

// Defense-in-depth beyond RLS: the target property must exist in the actor's
// operator. Gives a clear error instead of an opaque RLS insert failure on a
// tampered/foreign property id.
async function assertValidProperty(
  supabase: ServerClient,
  operatorId: string,
  propertyId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("operator_id", operatorId)
    .maybeSingle();

  if (!data) return "Property not found in your operator.";
  return null;
}

export async function setPrimaryAgentAction(
  propertyId: string,
  agentId: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const validationError = validateAgentId(agentId);
  if (validationError) return { ok: false, error: validationError };

  const supabase = await createServerClient();

  const agentError = await assertValidAgent(supabase, actor.operator_id, agentId);
  if (agentError) return { ok: false, error: agentError };

  const propertyError = await assertValidProperty(
    supabase,
    actor.operator_id,
    propertyId,
  );
  if (propertyError) return { ok: false, error: propertyError };

  const current = await getCurrentAssignment(supabase, actor.operator_id, propertyId);
  const plan = planAssignmentChange(current, agentId);

  if (plan.action === "noop") return { ok: true };

  // Close-then-insert: end the prior active row before opening the new one so a
  // mid-failure leaves the property unassigned (safe), never double-assigned.
  if (plan.action === "reassign") {
    const { error: closeError } = await supabase
      .from("property_assignments")
      .update({ effective_until: new Date().toISOString() })
      .eq("id", plan.closeId);
    if (closeError) {
      return {
        ok: false,
        error: `Failed to update assignment: ${closeError.message}`,
      };
    }
  }

  const insert: AssignmentInsert = {
    operator_id: actor.operator_id,
    property_id: propertyId,
    primary_agent_id: agentId,
  };
  const { error: insertError } = await supabase
    .from("property_assignments")
    .insert(insert);

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: "This assignment just changed. Please refresh and try again.",
      };
    }
    return { ok: false, error: `Failed to assign agent: ${insertError.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action:
      plan.action === "reassign" ? AUDIT_ACTIONS.ASSIGNMENT_CHANGED : AUDIT_ACTIONS.ASSIGNMENT_CREATED,
    entityType: "property_assignment",
    entityId: propertyId,
    details: {
      property_id: propertyId,
      primary_agent_id: agentId,
      previous_agent_id:
        plan.action === "reassign" ? (current?.primary_agent_id ?? null) : null,
    },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}

export async function unassignPrimaryAgentAction(
  propertyId: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const propertyError = await assertValidProperty(
    supabase,
    actor.operator_id,
    propertyId,
  );
  if (propertyError) return { ok: false, error: propertyError };

  const current = await getCurrentAssignment(
    supabase,
    actor.operator_id,
    propertyId,
  );
  if (!current) return { ok: true };

  const { error } = await supabase
    .from("property_assignments")
    .update({ effective_until: new Date().toISOString() })
    .eq("id", current.id);

  if (error) {
    return { ok: false, error: `Failed to unassign agent: ${error.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.ASSIGNMENT_REMOVED,
    entityType: "property_assignment",
    entityId: propertyId,
    details: {
      property_id: propertyId,
      previous_agent_id: current.primary_agent_id,
    },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}

// Per-property, per-admin call-acceptance toggle. Upserted (a missing row is
// treated as accepting_calls=false). NOT audited — high-frequency, low-value
// per spec §6. RLS restricts each admin to their own (profile_id) rows.
export async function setCallAvailabilityAction(
  propertyId: string,
  accepting: boolean,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const row: AvailabilityInsert = {
    profile_id: actor.id,
    property_id: propertyId,
    operator_id: actor.operator_id,
    accepting_calls: accepting,
  };

  const { error } = await supabase
    .from("admin_call_availability")
    .upsert(row, { onConflict: "profile_id,property_id" });

  if (error) {
    return {
      ok: false,
      error: `Failed to update availability: ${error.message}`,
    };
  }

  revalidatePath("/admin");
  return { ok: true };
}

// Defense-in-depth beyond RLS (this table has zero client policies — see
// migration 0020): confirms the property exists in the actor's operator and
// returns its operator_id, so a tampered/foreign property id gets a clear
// error instead of an opaque write failure.
async function assertValidRemoteAccessProperty(
  admin: ReturnType<typeof createAdminClient>,
  operatorId: string,
  propertyId: string,
): Promise<{ operatorId: string } | { error: string }> {
  const { data } = await admin
    .from("properties")
    .select("id, operator_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!data || data.operator_id !== operatorId) {
    return { error: "Property not found in your operator." };
  }
  return { operatorId: data.operator_id };
}

// RustDesk unattended-access credentials (spec §3.5/D14). `property_remote_access`
// has NO client RLS policies at all — every access goes through this
// service-role path. Never log the password itself; only peer_id.
export async function upsertRemoteAccessAction(
  propertyId: string,
  peerId: string,
  password: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const peerError = validatePeerId(peerId);
  if (peerError) return { ok: false, error: peerError };

  const admin = createAdminClient();

  const propertyCheck = await assertValidRemoteAccessProperty(
    admin,
    actor.operator_id,
    propertyId,
  );
  if ("error" in propertyCheck) {
    return { ok: false, error: propertyCheck.error };
  }

  const { data: existing } = await admin
    .from("property_remote_access")
    .select("id, peer_id, unattended_password")
    .eq("property_id", propertyId)
    .maybeSingle();

  // Write-only model: an admin never sees the stored password, so a blank
  // password on an EXISTING row means "keep the current one" (e.g. to fix a
  // typo'd peer id). A blank password on a NEW row is still an error — fresh
  // credentials require a password.
  const keepPassword = password === "" && !!existing;
  if (!keepPassword) {
    const passwordError = validateUnattendedPassword(password);
    if (passwordError) return { ok: false, error: passwordError };
  }

  const trimmedPeerId = peerId.trim();

  if (keepPassword) {
    // Peer-id-only update. NOT an upsert: unattended_password is NOT NULL, so
    // an upsert's INSERT tuple would violate the constraint before ON CONFLICT
    // resolves. A row is guaranteed to exist here (keepPassword implies it).
    const { error } = await admin
      .from("property_remote_access")
      .update({ peer_id: trimmedPeerId })
      .eq("property_id", propertyId);

    if (error) {
      return {
        ok: false,
        error: `Failed to save remote-access credentials: ${error.message}`,
      };
    }

    await logAuditEvent({
      actorUserId: actor.id,
      action: AUDIT_ACTIONS.REMOTE_ACCESS_UPDATED,
      entityType: "property",
      entityId: propertyId,
      details: { peer_id: trimmedPeerId },
    });

    revalidatePath(`/admin/properties/${propertyId}`);
    return { ok: true };
  }

  const { error } = await admin.from("property_remote_access").upsert(
    {
      property_id: propertyId,
      operator_id: propertyCheck.operatorId,
      peer_id: trimmedPeerId,
      unattended_password: password,
    },
    { onConflict: "property_id" },
  );

  if (error) {
    return {
      ok: false,
      error: `Failed to save remote-access credentials: ${error.message}`,
    };
  }

  const isRotation =
    !!existing &&
    existing.peer_id === trimmedPeerId &&
    existing.unattended_password !== password;

  await logAuditEvent({
    actorUserId: actor.id,
    action: isRotation
      ? AUDIT_ACTIONS.REMOTE_ACCESS_ROTATED
      : AUDIT_ACTIONS.REMOTE_ACCESS_UPDATED,
    entityType: "property",
    entityId: propertyId,
    details: { peer_id: trimmedPeerId },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}

export async function deleteRemoteAccessAction(
  propertyId: string,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const admin = createAdminClient();

  const propertyCheck = await assertValidRemoteAccessProperty(
    admin,
    actor.operator_id,
    propertyId,
  );
  if ("error" in propertyCheck) {
    return { ok: false, error: propertyCheck.error };
  }

  const { data: existing } = await admin
    .from("property_remote_access")
    .select("peer_id")
    .eq("property_id", propertyId)
    .maybeSingle();

  if (!existing) {
    // Idempotent: nothing to remove.
    return { ok: true };
  }

  const { error } = await admin
    .from("property_remote_access")
    .delete()
    .eq("property_id", propertyId);

  if (error) {
    return {
      ok: false,
      error: `Failed to remove remote-access credentials: ${error.message}`,
    };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.REMOTE_ACCESS_REMOVED,
    entityType: "property",
    entityId: propertyId,
    details: { peer_id: existing.peer_id },
  });

  revalidatePath(`/admin/properties/${propertyId}`);
  return { ok: true };
}
