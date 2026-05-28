// Server-side role gate. Call from a Server Component layout to enforce that
// the current user has the given role. Redirects on mismatch — never returns
// to the caller in that case.
//
// Defense in depth: middleware.ts handles the "no session at all" case for
// every route, but requireRole repeats the session check so layouts are safe
// in isolation (e.g., if the middleware matcher ever changes).

import { redirect } from "next/navigation";
import type { Role } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";

export type RequiredProfile = {
  id: string;
  role: Role;
  operator_id: string;
  active: boolean;
};

export async function requireRole(role: Role): Promise<RequiredProfile> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, operator_id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  if (profile.role !== role) {
    redirect("/");
  }

  return profile;
}
