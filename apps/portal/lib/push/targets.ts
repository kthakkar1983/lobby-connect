// Who gets a push for an incoming call at this property? Mirrors the
// incoming-video poll scope (assigned primary agent + admins covering with
// accepting_calls=true) — see resolveTargetPropertyIds in
// app/api/calls/incoming-video/route.ts. Presence NOT gated: push IS the
// wake-up path.
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Raw statuses that silence VIDEO for a user. A DENY-LIST on purpose: only these
 * two explicit, agent-set signals silence — OFFLINE (End shift) and AWAY (the
 * "not accepting calls" toggle; mirrors audio, whose reachable set is
 * AVAILABLE/ON_CALL only). Any other value — AVAILABLE, ON_CALL, or a
 * null/unknown status from a DB blip — is NOT silenced, so the gate FAILS OPEN
 * and never silences a live agent. Do NOT flip this to an allow-list
 * (AVAILABLE/ON_CALL) — that would fail CLOSED on a status-read error.
 */
export function isVideoSilencedStatus(status: string): boolean {
  return status === "OFFLINE" || status === "AWAY";
}

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

  // Drop anyone whose shift is off OR who isn't accepting calls (raw status
  // 'OFFLINE' = End shift; 'AWAY' = the "not accepting calls" toggle — parity with
  // audio, whose reachable set is AVAILABLE/ON_CALL only). Both are explicit
  // agent-set signals; the daily stale-sweep also sets OFFLINE, which is fine.
  // Gate on the RAW stored status, NOT effectivePresence/last_seen_at: a minimized
  // on-shift tab (behind fullscreen RustDesk) throttles its heartbeat, so staleness
  // would read it OFFLINE even though the agent is on duty — and waking that agent
  // via push is the entire point. Do NOT switch this to effectivePresence, and do
  // NOT flip it to an allow-list — see isVideoSilencedStatus (fail-open).
  const { data: presence } = await admin
    .from("profiles")
    .select("id, status")
    .in("id", [...ids]);
  const silenced = new Set(
    ((presence ?? []) as Array<{ id: string; status: string }>)
      .filter((p) => isVideoSilencedStatus(p.status))
      .map((p) => p.id),
  );
  return [...ids].filter((id) => !silenced.has(id));
}
