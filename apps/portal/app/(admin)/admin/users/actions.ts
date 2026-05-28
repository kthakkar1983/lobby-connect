"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/require-role";
import { inviteUser } from "@/lib/users/invite";
import {
  validateEmail,
  validateFullName,
  validateRole,
} from "@/lib/users/validate";
import {
  assertNotSelfDemote,
  assertNotSelfDeactivate,
  assertNotSelfDelete,
  type UserPatch,
} from "@/lib/users/guards";
import { env } from "@/lib/env";
import type { Role } from "@lc/shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function inviteUserAction(input: {
  email: string;
  full_name: string;
  role: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const emailError = validateEmail(input.email);
  if (emailError) return { ok: false, error: emailError };

  const nameError = validateFullName(input.full_name);
  if (nameError) return { ok: false, error: nameError };

  const roleError = validateRole(input.role);
  if (roleError) return { ok: false, error: roleError };

  const admin = createAdminClient();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const result = await inviteUser({
    admin,
    operatorId: actor.operator_id,
    input: {
      email: input.email.trim().toLowerCase(),
      full_name: input.full_name.trim(),
      role: input.role as Role,
    },
    redirectTo: `${appUrl}/auth/callback?next=/onboarding`,
  });

  if (!result.ok) return result;

  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.invited",
    entityType: "user",
    entityId: result.userId,
    details: {
      email: input.email.trim().toLowerCase(),
      role: input.role,
      full_name: input.full_name.trim(),
    },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

type UpdateInput = {
  targetUserId: string;
  full_name?: string;
  role?: string;
  active?: boolean;
};

export async function updateUserAction(
  input: UpdateInput,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const patch: UserPatch = {};
  if (input.full_name !== undefined) {
    const nameError = validateFullName(input.full_name);
    if (nameError) return { ok: false, error: nameError };
    patch.full_name = input.full_name.trim();
  }
  if (input.role !== undefined) {
    const roleError = validateRole(input.role);
    if (roleError) return { ok: false, error: roleError };
    patch.role = input.role as Role;
  }
  if (input.active !== undefined) {
    patch.active = input.active;
  }

  const demoteError = assertNotSelfDemote({
    actorId: actor.id,
    targetId: input.targetUserId,
    patch,
  });
  if (demoteError) return { ok: false, error: demoteError };

  const deactivateError = assertNotSelfDeactivate({
    actorId: actor.id,
    targetId: input.targetUserId,
    patch,
  });
  if (deactivateError) return { ok: false, error: deactivateError };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("profiles")
    .select(
      "id, operator_id, full_name, role, active, twilio_identity",
    )
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  type ProfileUpdates = {
    full_name?: string;
    role?: Role;
    active?: boolean;
    twilio_identity?: string | null;
  };
  const updates: ProfileUpdates = {};
  const auditEvents: Array<{ action: string; details: unknown }> = [];

  if (
    patch.full_name !== undefined &&
    patch.full_name !== target.full_name
  ) {
    updates.full_name = patch.full_name;
    auditEvents.push({
      action: "user.profile_edited",
      details: {
        field: "full_name",
        from: target.full_name,
        to: patch.full_name,
      },
    });
  }

  if (patch.role !== undefined && patch.role !== target.role) {
    updates.role = patch.role;
    if (
      target.twilio_identity === null &&
      (patch.role === "AGENT" || patch.role === "ADMIN")
    ) {
      updates.twilio_identity = `user-${target.id.slice(0, 8)}`;
    }
    auditEvents.push({
      action: "user.role_changed",
      details: { from: target.role, to: patch.role },
    });
  }

  if (patch.active !== undefined && patch.active !== target.active) {
    updates.active = patch.active;
    auditEvents.push({
      action: "user.active_toggled",
      details: { from: target.active, to: patch.active },
    });
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update(updates)
    .eq("id", input.targetUserId);

  if (error) {
    return { ok: false, error: `Failed to update user: ${error.message}` };
  }

  for (const evt of auditEvents) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: evt.action,
      entityType: "user",
      entityId: input.targetUserId,
      details: evt.details as never,
    });
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function hardDeleteUserAction(input: {
  targetUserId: string;
  confirmEmail: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const guardError = assertNotSelfDelete({
    actorId: actor.id,
    targetId: input.targetUserId,
  });
  if (guardError) return { ok: false, error: guardError };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, operator_id, email, full_name")
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  if (input.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
    return {
      ok: false,
      error: "Email confirmation did not match. Deletion aborted.",
    };
  }

  // Audit BEFORE delete so the actor's profile + the target snapshot exist.
  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.deleted",
    entityType: "user",
    entityId: target.id,
    details: { email: target.email, full_name: target.full_name },
  });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(input.targetUserId);

  if (error) {
    return { ok: false, error: `Failed to delete user: ${error.message}` };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
