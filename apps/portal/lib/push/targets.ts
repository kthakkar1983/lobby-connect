// Who gets a push for an incoming call at this property? Mirrors the
// incoming-video poll scope (assigned primary agent + admins covering with
// accepting_calls=true) — see resolveTargetPropertyIds in
// app/api/calls/incoming-video/route.ts. Presence NOT gated: push IS the
// wake-up path.
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export async function resolveTargetUserIds(admin: Admin, propertyId: string): Promise<string[]> {
  const ids = new Set<string>();

  const { data: assigned } = await admin
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null);
  for (const r of (assigned ?? []) as Array<{ primary_agent_id: string }>) ids.add(r.primary_agent_id);

  const { data: covering } = await admin
    .from("admin_call_availability")
    .select("profile_id")
    .eq("property_id", propertyId)
    .eq("accepting_calls", true);
  for (const r of (covering ?? []) as Array<{ profile_id: string }>) ids.add(r.profile_id);

  return [...ids];
}
