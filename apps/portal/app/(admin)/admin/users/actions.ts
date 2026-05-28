"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/require-role";
import { inviteUser } from "@/lib/users/invite";
import {
  validateEmail,
  validateFullName,
  validateRole,
} from "@/lib/users/validate";
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
