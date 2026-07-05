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

  if (ids.size === 0) return [];

  // Drop anyone who has explicitly ended their shift (raw status='OFFLINE', the
  // End-shift write; the daily stale-sweep also sets it, which is fine). Gate on
  // the RAW stored status, NOT effectivePresence/last_seen_at: a minimized on-shift
  // tab (behind fullscreen RustDesk) throttles its heartbeat, so staleness would
  // read it OFFLINE even though the agent is on duty — and waking that agent via
  // push is the entire point. Do NOT "helpfully" switch this to effectivePresence.
  const { data: presence } = await admin
    .from("profiles")
    .select("id, status")
    .in("id", [...ids]);
  const offline = new Set(
    ((presence ?? []) as Array<{ id: string; status: string }>)
      .filter((p) => p.status === "OFFLINE")
      .map((p) => p.id),
  );
  return [...ids].filter((id) => !offline.has(id));
}
