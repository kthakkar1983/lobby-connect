// Server-side role gate. Call from a Server Component layout to enforce that
// the current user has the given role. Redirects on mismatch — never returns
// to the caller in that case.
//
// Defense in depth: middleware.ts handles the "no session at all" case for
// every route, but requireRole repeats the session check so layouts are safe
// in isolation (e.g., if the middleware matcher ever changes).

import { redirect } from "next/navigation";
import type { Role } from "@lc/shared";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";

// Now includes full_name + email — additive, backward-compatible with all callers.
export type RequiredProfile = SessionProfile;

export async function requireRole(role: Role): Promise<RequiredProfile> {
  const profile = await getSessionProfile();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  if (profile.must_change_password) {
    redirect("/onboarding");
  }

  if (profile.role !== role) {
    redirect("/");
  }

  return profile;
}
