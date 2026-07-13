"use server";

// Task 20 (shift-tracking plan): admin shift edit/delete/add, audited. Modeled
// on `admin/users/actions.ts` — requireRole("ADMIN") first, validate, read the
// target scoped to the actor's operator via the session-scoped client (RLS),
// write via `createAdminClient()` with an explicit operator/id scope,
// `logAuditEvent`, `revalidatePath`.

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { requireRole } from "@/lib/auth/require-role";
import { validateShiftTimes } from "@/lib/shifts/validate";

export type ActionResult = { ok: true } | { ok: false; error: string };

type EditShiftInput = {
  id: string;
  started_at: string;
  ended_at: string | null;
};

export async function editShiftAction(
  input: EditShiftInput,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const timeError = validateShiftTimes(input.started_at, input.ended_at);
  if (timeError) return { ok: false, error: timeError };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("shifts")
    .select("id, operator_id, ended_reason")
    .eq("id", input.id)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "Shift not found in your operator." };
  }

  // Editing an open shift's end time closes it via this edit — stamp
  // ended_reason "manual" so the timesheet's Ended badge (which reads
  // ended_reason === null as "On shift") doesn't disagree with the now-set
  // ended_at. Editing an already-closed shift's times leaves its existing
  // reason (manual/lapsed/capped) alone — we're correcting a timestamp, not
  // reclassifying why it ended. Clearing ended_at back to null (re-opening)
  // clears the reason to match; the DB's one-open-shift-per-user unique index
  // will reject this if the agent already has a live shift, surfaced below.
  const ended_reason =
    input.ended_at === null ? null : (target.ended_reason ?? "manual");

  const admin = createAdminClient();
  const { error } = await admin
    .from("shifts")
    .update({
      started_at: input.started_at,
      ended_at: input.ended_at,
      ended_reason,
      edited_by: actor.id,
      edited_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("operator_id", actor.operator_id);

  if (error) {
    return { ok: false, error: `Failed to update shift: ${error.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.SHIFT_EDITED,
    entityType: "shift",
    entityId: input.id,
    details: {
      started_at: input.started_at,
      ended_at: input.ended_at,
    },
  });

  revalidatePath("/admin/shifts");
  return { ok: true };
}

type DeleteShiftInput = { id: string };

export async function deleteShiftAction(
  input: DeleteShiftInput,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("shifts")
    .select("id, operator_id, user_id, started_at, ended_at, ended_reason")
    .eq("id", input.id)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "Shift not found in your operator." };
  }

  // Audit BEFORE the delete (hard-delete convention). Unlike the user
  // hard-delete (which writes its audit row AFTER — an FK RESTRICT on calls/
  // incidents/property ownership can make that delete fail, and auditing
  // first there left phantom user.deleted rows), a shift has no such
  // RESTRICT: shift_breaks references it ON DELETE CASCADE, so once the row
  // is found and operator-scoped there's no realistic failure mode left to
  // create a phantom entry for.
  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.SHIFT_DELETED,
    entityType: "shift",
    entityId: target.id,
    details: {
      user_id: target.user_id,
      started_at: target.started_at,
      ended_at: target.ended_at,
      ended_reason: target.ended_reason,
    },
  });

  const admin = createAdminClient();
  const { error } = await admin
    .from("shifts")
    .delete()
    .eq("id", input.id)
    .eq("operator_id", actor.operator_id);

  if (error) {
    return { ok: false, error: `Failed to delete shift: ${error.message}` };
  }

  revalidatePath("/admin/shifts");
  return { ok: true };
}

type AddShiftInput = {
  user_id: string;
  started_at: string;
  ended_at: string;
};

export async function addShiftAction(
  input: AddShiftInput,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const timeError = validateShiftTimes(input.started_at, input.ended_at);
  if (timeError) return { ok: false, error: timeError };

  // Cross-operator guard: confirm the target user belongs to the actor's
  // operator before inserting (mirrors updateUserAction's target-scope check)
  // so an admin can't backfill a shift row for another operator's user.
  const supabase = await createServerClient();
  const { data: targetUser } = await supabase
    .from("profiles")
    .select("id, operator_id")
    .eq("id", input.user_id)
    .maybeSingle();

  if (!targetUser || targetUser.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("shifts")
    .insert({
      operator_id: actor.operator_id,
      user_id: input.user_id,
      started_at: input.started_at,
      ended_at: input.ended_at,
      ended_reason: "manual",
      edited_by: actor.id,
      edited_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: `Failed to add shift: ${error.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: AUDIT_ACTIONS.SHIFT_CREATED_MANUAL,
    entityType: "shift",
    entityId: inserted.id,
    details: {
      user_id: input.user_id,
      started_at: input.started_at,
      ended_at: input.ended_at,
    },
  });

  revalidatePath("/admin/shifts");
  return { ok: true };
}
