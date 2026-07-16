import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { REAP_RINGING_AFTER_MS } from "@/lib/calls/reaper";
import { requireApiActor, type ApiActor } from "@/lib/auth/api-actor";
import { isVideoSilencedStatus } from "@/lib/push/targets";

export const runtime = "nodejs";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The properties this user is a live VIDEO-call target for — the poll-side mirror
 * of the audio dial set (`resolvePrimaryAgent` + `resolveAvailableAdmins` in
 * `twilio/voice/incoming`): the property's assigned primary agent, plus admins who
 * have toggled `accepting_calls` on for it.
 *
 * Without this scope the poll returned EVERY ringing video call to EVERY logged-in
 * agent/admin, so an admin with covering off — or an agent not assigned to the
 * property — still rang (the s1-test bug; audio already scoped, video did not).
 *
 * Presence is deliberately NOT gated here: the act of polling proves the client is
 * live, and a momentarily stale heartbeat must not silence a present user. (The
 * audio path gates presence only to avoid dialing a dead Twilio identity.)
 */
async function resolveTargetPropertyIds(admin: Admin, actor: ApiActor): Promise<string[]> {
  const ids = new Set<string>();

  // Assigned primary agent (any role can be assigned — mirrors resolvePrimaryAgent).
  const { data: assigned } = await admin
    .from("property_assignments")
    .select("property_id")
    .eq("primary_agent_id", actor.userId)
    .is("effective_until", null);
  for (const r of (assigned ?? []) as Array<{ property_id: string }>) {
    ids.add(r.property_id);
  }

  // Admins additionally cover the properties they're accepting calls for.
  if (actor.role === "ADMIN") {
    const { data: accepting } = await admin
      .from("admin_call_availability")
      .select("property_id")
      .eq("profile_id", actor.userId)
      .eq("accepting_calls", true);
    for (const r of (accepting ?? []) as Array<{ property_id: string }>) {
      ids.add(r.property_id);
    }
  }

  return [...ids];
}

export async function GET(_request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const admin = createAdminClient();

  // Off-shift / not-accepting silences video too: if the actor has explicitly
  // ended their shift (raw status='OFFLINE') OR toggled "not accepting calls"
  // (status='AWAY' — parity with audio), their own open tab must stop ringing
  // cards. Gate on the RAW stored status via the shared deny-list predicate, NOT
  // effectivePresence/staleness — a minimized on-shift tab throttles its heartbeat
  // and must keep polling so it still rings (the point of Phase C). A null/absent
  // status FAILS OPEN (not silenced). `requireApiActor` doesn't return status, so
  // read it directly.
  const { data: actorPresence } = await admin
    .from("profiles")
    .select("status")
    .eq("id", actor.userId)
    .maybeSingle();
  const actorStatus = (actorPresence as { status?: string } | null)?.status;
  if (actorStatus && isVideoSilencedStatus(actorStatus)) {
    return NextResponse.json({ calls: [] });
  }

  // Scope to the calls THIS user is a target for (parity with the audio path).
  // An empty scope means there's nothing this user could answer — skip the query
  // entirely so an unassigned agent / covering-off admin never rings.
  const targetPropertyIds = await resolveTargetPropertyIds(admin, actor);
  if (targetPropertyIds.length === 0) {
    return NextResponse.json({ calls: [] });
  }

  // Time-bound the RINGING window: a crashed kiosk leaks a RINGING row that the
  // daily reaper only closes much later, so without this bound a dead call rings
  // the agent's softphone for hours. The ring window is 120s; anything older than
  // the reaper's RINGING cutoff is a phantom and must not surface.
  const ringingSince = new Date(Date.now() - REAP_RINGING_AFTER_MS).toISOString();
  const { data: rows } = await admin
    .from("calls")
    .select("id, property_id, agora_channel_name, ring_started_at")
    .eq("operator_id", actor.operatorId)
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    // Agent-initiated outbound calls (start-outbound-video) are RINGING too, but
    // ring the KIOSK, not this agent — without this filter the originating
    // agent's own outbound row would surface right back as an incoming call.
    .eq("direction", "INBOUND")
    .in("property_id", targetPropertyIds)
    .gte("ring_started_at", ringingSince)
    .order("ring_started_at", { ascending: true });

  const calls = rows ?? [];
  const propertyIds = [...new Set(calls.map((c) => c.property_id as string))];

  let nameById = new Map<string, string>();
  let tzById = new Map<string, string | null>();
  if (propertyIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, name, timezone")
      .in("id", propertyIds);
    nameById = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
    tzById = new Map((props ?? []).map((p) => [p.id as string, (p.timezone as string | null) ?? null]));
  }

  return NextResponse.json({
    calls: calls.map((c) => ({
      id: c.id,
      channelName: c.agora_channel_name,
      propertyId: c.property_id,
      propertyName: nameById.get(c.property_id as string) ?? "Property",
      timezone: tzById.get(c.property_id as string) ?? null,
      ringStartedAt: c.ring_started_at,
    })),
  });
}
