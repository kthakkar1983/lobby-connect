import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role } from "@lc/shared";

export type InviteInput = {
  email: string;
  full_name: string;
  role: Role;
};

export type InviteResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

type Args = {
  admin: SupabaseClient<Database>;
  operatorId: string;
  input: InviteInput;
  redirectTo: string;
};

function twilioIdentityFor(role: Role, userId: string): string | null {
  if (role === "OWNER") return null;
  return `user-${userId.slice(0, 8)}`;
}

export async function inviteUser(args: Args): Promise<InviteResult> {
  const email = args.input.email.trim().toLowerCase();

  // 1. Pre-check existing profile.
  const { data: existing } = await args.admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: "A user with this email already exists.",
    };
  }

  // 2. Invite via Supabase Auth.
  const { data: invited, error: inviteError } =
    await args.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: args.redirectTo,
      data: {
        full_name: args.input.full_name,
        role: args.input.role,
      },
    });

  if (inviteError || !invited?.user) {
    const message = inviteError?.message ?? "unknown error";
    return {
      ok: false,
      error: `Failed to send invitation: ${message}`,
    };
  }

  const newUserId = invited.user.id;

  // 3. Insert profile.
  const { error: insertError } = await args.admin.from("profiles").insert({
    id: newUserId,
    operator_id: args.operatorId,
    role: args.input.role,
    full_name: args.input.full_name,
    email,
    twilio_identity: twilioIdentityFor(args.input.role, newUserId),
    status: "OFFLINE",
    active: true,
  });

  if (insertError) {
    // 4. Roll back the auth user so the operator can retry cleanly.
    await args.admin.auth.admin.deleteUser(newUserId);
    return {
      ok: false,
      error: `Failed to create profile: ${insertError.message}`,
    };
  }

  return { ok: true, userId: newUserId };
}
