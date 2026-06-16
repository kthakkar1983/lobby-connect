"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { logSignIn } from "@/lib/auth/audit";
import { mapSignInError, validateSignInInput } from "@/lib/auth/sign-in-errors";

export type SignInState = {
  error: string | null;
};

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const inputError = validateSignInInput(email, password);
  if (inputError) {
    return { error: inputError };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: mapSignInError({ code: error?.code, status: error?.status }) };
  }

  // Block deactivated users with a specific message. GoTrue authenticates them
  // (active is our app flag, not GoTrue's), so sign them back out before any
  // protected route silently bounces them to /sign-in.
  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return {
      error: "This account has been deactivated. Please contact your administrator.",
    };
  }

  await logSignIn(data.user.id);
  redirect("/");
}
