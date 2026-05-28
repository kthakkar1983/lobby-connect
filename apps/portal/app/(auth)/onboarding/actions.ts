"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  validateFullName,
  validatePassword,
} from "@/lib/users/validate";

export type OnboardingState = {
  error: string | null;
};

export async function onboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }
  const nameError = validateFullName(fullName);
  if (nameError) return { error: nameError };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error: updateAuthError } = await supabase.auth.updateUser({
    password,
  });
  if (updateAuthError) {
    return { error: "Failed to set password. Please try again." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const nameChanged = profile != null && profile.full_name !== fullName;

  if (nameChanged) {
    const { error: nameUpdateError } = await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    if (nameUpdateError) {
      return {
        error:
          "Password saved, but couldn't update your name. Try again from your account page.",
      };
    }
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "user.onboarded",
    entityType: "user",
    entityId: user.id,
    details: { name_changed: nameChanged },
  });

  redirect("/");
}
