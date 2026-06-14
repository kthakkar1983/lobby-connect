"use server";

import { createServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type ForgotPasswordState = {
  error: string | null;
  success: boolean;
};

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter your email address.", success: false };
  }

  const supabase = await createServerClient();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectTo = `${appUrl}/auth/confirm?type=recovery&next=/auth/update-password`;

  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  // Always succeed — never confirm whether the email is registered.
  return { error: null, success: true };
}
