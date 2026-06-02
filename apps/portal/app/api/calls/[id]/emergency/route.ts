import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioRestClient } from "@/lib/twilio/client";
import { getTwilioConfig } from "@/lib/twilio/config";
import { findAgentLeg, addEmergencyParticipant } from "@/lib/twilio/conference";
import { emergencyConferenceName, buildConferenceTwiml } from "@/lib/emergency/conference";
import { canTriggerEmergency } from "@/lib/emergency/guards";
import { getEmergencyDialNumber, getEmergencyCallerId } from "@/lib/emergency/dispatch";
import { logAuditEvent } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  const { data: callRow } = await admin
    .from("calls")
    .select(
      "id, operator_id, property_id, channel, state, twilio_call_sid, handled_by_user_id, emergency_conference_name",
    )
    .eq("id", id)
    .maybeSingle();
  if (!callRow || callRow.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Idempotent: already escalated — return the existing conference, do nothing.
  if (callRow.emergency_conference_name) {
    return NextResponse.json({
      ok: true,
      conferenceName: callRow.emergency_conference_name,
      alreadyActive: true,
    });
  }

  if (
    !canTriggerEmergency({
      state: callRow.state,
      channel: callRow.channel,
      handledByUserId: callRow.handled_by_user_id,
      userId: user.id,
    })
  ) {
    return NextResponse.json(
      { error: "Emergency not allowed for this call" },
      { status: 409 },
    );
  }

  const confName = emergencyConferenceName(callRow.id);

  // 1. Stamp FIRST so /dial-result routes the guest into the conference once the
  //    agent leg leaves the <Dial><Client> bridge.
  await admin
    .from("calls")
    .update({ emergency_conference_name: confName })
    .eq("id", callRow.id);

  // 2. Registered caller ID for the emergency leg.
  const { data: property } = await admin
    .from("properties")
    .select("routing_did")
    .eq("id", callRow.property_id)
    .maybeSingle();
  const cfg = getTwilioConfig();
  const callerId = getEmergencyCallerId(
    { routing_did: property?.routing_did ?? null },
    cfg.phoneNumber,
  );
  const dialTo = getEmergencyDialNumber();

  const client = getTwilioRestClient();
  const parentSid = callRow.twilio_call_sid ?? "";

  // 3. Redirect the agent's live leg into the conference; the guest follows via
  //    /dial-result. Fallback: redirect the guest parent directly (agent drops,
  //    guest still reaches 911).
  let fallbackUsed = false;
  let degradedNote: string | null = null;
  try {
    const agentLeg = await findAgentLeg(client, parentSid);
    if (agentLeg) {
      await client.calls(agentLeg).update({ twiml: buildConferenceTwiml(confName) });
    } else {
      fallbackUsed = true;
      degradedNote = "no live agent leg; redirected guest parent directly (agent dropped)";
      if (parentSid) {
        await client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) });
      }
    }
  } catch (err) {
    fallbackUsed = true;
    degradedNote = `agent-leg redirect failed: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (parentSid) {
        await client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) });
      }
    } catch (err2) {
      console.error("[emergency] guest parent redirect also failed:", err2);
    }
  }

  // 4. Add the emergency leg (911 in prod; 933 in dev/test).
  let emergencyCallSid: string | null = null;
  let dispatchError: string | null = null;
  try {
    const participant = await addEmergencyParticipant(client, confName, {
      from: callerId,
      to: dialTo,
    });
    emergencyCallSid = participant.callSid;
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error("[emergency] add emergency participant failed:", err);
  }

  // 5. Log the incident (best-effort) + audit.
  const notes =
    [degradedNote, dispatchError ? `dispatch error: ${dispatchError}` : null]
      .filter(Boolean)
      .join("; ") || null;
  await admin.from("incidents").insert({
    operator_id: callRow.operator_id,
    property_id: callRow.property_id,
    call_id: callRow.id,
    triggered_by: user.id,
    severity: "HIGH",
    kind: "EMERGENCY_911",
    dispatched_to: dialTo,
    conference_name: confName,
    conference_sid: null,
    emergency_call_sid: emergencyCallSid,
    status: "OPEN",
    notes,
  });

  await logAuditEvent({
    actorUserId: user.id,
    action: "trigger_emergency",
    entityType: "call",
    entityId: callRow.id,
    details: { conferenceName: confName, dispatchedTo: dialTo, fallbackUsed, dispatchError },
  });

  if (dispatchError) {
    return NextResponse.json(
      { error: "Emergency dispatch failed", conferenceName: confName, fallbackUsed },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, conferenceName: confName, fallbackUsed });
}
