"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { validatePassword } from "@/lib/users/validate";

export type UpdatePasswordState = {
  error: string | null;
};

export async function updatePasswordAction(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Failed to update password. Please try again." };
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: "user",
    entityId: user.id,
  });

  redirect("/");
}
