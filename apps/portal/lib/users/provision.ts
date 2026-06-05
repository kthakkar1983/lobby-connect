import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role } from "@lc/shared";

import { identityForRole } from "@/lib/users/twilio-identity";

export type ProvisionInput = {
  email: string;
  full_name: string;
  role: Role;
  tempPassword: string;
};

export type ProvisionResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

type Args = {
  admin: SupabaseClient<Database>;
  operatorId: string;
  input: ProvisionInput;
};

export async function provisionUser(args: Args): Promise<ProvisionResult> {
  const email = args.input.email.trim().toLowerCase();

  // 1. Pre-check existing profile.
  const { data: existing } = await args.admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  // 2. Create a confirmed auth user with the admin-typed temp password.
  //    email_confirm: true => no email is sent; the user can sign in immediately.
  const { data: created, error: createError } =
    await args.admin.auth.admin.createUser({
      email,
      password: args.input.tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: args.input.full_name,
        role: args.input.role,
      },
    });

  if (createError || !created?.user) {
    const message = createError?.message ?? "unknown error";
    return { ok: false, error: `Failed to create user: ${message}` };
  }

  const newUserId = created.user.id;

  // 3. Insert profile. must_change_password forces onboarding at first sign-in.
  const { error: insertError } = await args.admin.from("profiles").insert({
    id: newUserId,
    operator_id: args.operatorId,
    role: args.input.role,
    full_name: args.input.full_name,
    email,
    twilio_identity: identityForRole(args.input.role, newUserId),
    status: "OFFLINE",
    active: true,
    must_change_password: true,
  });

  if (insertError) {
    // 4. Roll back the auth user so the admin can retry cleanly.
    await args.admin.auth.admin.deleteUser(newUserId);
    return { ok: false, error: `Failed to create profile: ${insertError.message}` };
  }

  return { ok: true, userId: newUserId };
}
