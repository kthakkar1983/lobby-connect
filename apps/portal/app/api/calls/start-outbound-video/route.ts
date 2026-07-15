import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";

import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOnDuty } from "@/lib/shifts/gate";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
import { ACTIVE_CALL_STATES } from "@/lib/voice/call-state";

export const runtime = "nodejs";

/**
 * Agent-initiated outbound video call: the reverse of `kiosk/call-started`. An
 * on-duty AGENT/ADMIN dials a property's kiosk (from a property card or the
 * "Call back" shortcut) instead of the kiosk dialing in. Creates an
 * OUTBOUND/RINGING VIDEO `calls` row, puts the originating agent ON_CALL
 * immediately (mirrors answer-video's winner-side write), and nudges Realtime
 * so the agent's own dashboard reflects the live call. The kiosk discovers the
 * row via its own poll (Task 6) and answers it (Task 7) into the same
 * byte-identical connected surface as an inbound call.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const admin = createAdminClient();

  // An off-duty agent must not ring a kiosk (mirrors answer-video's shift gate).
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;

  const body = (await request.json().catch(() => ({}))) as { propertyId?: string };
  const propertyId = body.propertyId;
  if (!propertyId) {
    return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
  }

  // Property must exist, be active, and belong to the actor's operator.
  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, active")
    .eq("id", propertyId)
    .eq("operator_id", actor.operatorId)
    .maybeSingle();
  if (!property || property.active === false) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // An agent already on a live call must not originate another (one call at a
  // time — a human handles one guest at a time). Keys on live call ROWS
  // (handled_by_user_id), not profiles.status, so a stale ON_CALL from a missed
  // presence reset (task_71d65b0a) can't false-block. Best-effort app-layer
  // guard: a millisecond double-submit to two DIFFERENT properties could still
  // slip past; a same-property double is caught by the 0016 one-active index.
  const { data: existingActive } = await admin
    .from("calls")
    .select("id")
    .eq("handled_by_user_id", actor.userId)
    .in("state", ACTIVE_CALL_STATES)
    .limit(1);
  if (existingActive && existingActive.length > 0) {
    return NextResponse.json({ error: "You are already on a call" }, { status: 409 });
  }

  const channelName = `call_${randomUUID().replace(/-/g, "")}`;

  const { data: inserted, error: insertError } = await admin
    .from("calls")
    .insert({
      operator_id: property.operator_id,
      property_id: property.id,
      channel: "VIDEO",
      state: "RINGING",
      direction: "OUTBOUND",
      agora_channel_name: channelName,
      handled_by_user_id: actor.userId,
    })
    .select("id")
    .single();

  if (insertError) {
    // One-active-call index (0016): a call is already live for this property.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "A call is already active for this property" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }
  if (!inserted) {
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }

  // The originating agent goes ON_CALL immediately (reset on end-video — Task 8).
  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  // after() (waitUntil-backed) guarantees the broadcast fires before the function
  // freezes; a bare `void` detached fetch is not guaranteed to run. No push here
  // (unlike inbound call-started) — an outbound call must never push-ring the
  // agent who just placed it.
  after(() => {
    void broadcastCallsChanged(actor.operatorId);
  });

  return NextResponse.json({ callId: inserted.id, channelName });
}
