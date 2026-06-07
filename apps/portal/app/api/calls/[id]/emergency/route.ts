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
import { withTimeout } from "@/lib/util/timeout";

export const runtime = "nodejs";
// Bound the whole irreversible 911 choreography so a hung Twilio dependency can
// never wedge the request open indefinitely.
export const maxDuration = 30;

// Per-Twilio-REST-call bound, shorter than maxDuration so a single hung call
// degrades to the handled failure path rather than killing the whole function.
const TWILIO_OP_TIMEOUT_MS = 8000;

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

  // Idempotent fast-path: already escalated — return the existing conference.
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

  // 1. Atomically CLAIM the escalation: flip emergency_conference_name from NULL
  //    in a single guarded UPDATE. A concurrent double-tap loses the
  //    `.is(...,null)` race (zero rows returned) and no-ops as already-active, so
  //    exactly one request ever dials 911 — TOCTOU-safe (the earlier read is only
  //    a fast-path; this claim is the real guard). The stamp is also the
  //    precondition /dial-result keys on to route the guest into the conference.
  const { data: claimed, error: stampError } = await admin
    .from("calls")
    .update({ emergency_conference_name: confName })
    .eq("id", callRow.id)
    .is("emergency_conference_name", null)
    .select("id");
  if (stampError) {
    return NextResponse.json(
      { error: "Could not initiate emergency" },
      { status: 503 },
    );
  }
  if (!claimed || claimed.length === 0) {
    // Lost the claim race: another request already escalated this call.
    return NextResponse.json({
      ok: true,
      conferenceName: confName,
      alreadyActive: true,
    });
  }

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
  //    guest still reaches 911). Each REST call is time-bounded so a hung Twilio
  //    API degrades to the fallback / dispatch-failure path instead of hanging.
  let fallbackUsed = false;
  let agentInConference = false;
  let degradedNote: string | null = null;
  try {
    const agentLeg = await withTimeout(
      findAgentLeg(client, parentSid),
      TWILIO_OP_TIMEOUT_MS,
      "findAgentLeg",
    );
    if (agentLeg) {
      await withTimeout(
        client.calls(agentLeg).update({ twiml: buildConferenceTwiml(confName) }),
        TWILIO_OP_TIMEOUT_MS,
        "redirect agent leg",
      );
      agentInConference = true;
      // Persist the agent's conference leg SID so /emergency/control can mute/remove
      // it server-side (the browser SDK can no longer control a redirected leg).
      await admin
        .from("calls")
        .update({ emergency_agent_call_sid: agentLeg })
        .eq("id", callRow.id);
    } else {
      fallbackUsed = true;
      degradedNote = "no live agent leg; redirected guest parent directly (agent dropped)";
      if (parentSid) {
        await withTimeout(
          client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) }),
          TWILIO_OP_TIMEOUT_MS,
          "redirect guest parent",
        );
      }
    }
  } catch (err) {
    fallbackUsed = true;
    degradedNote = `agent-leg redirect failed; redirected guest parent directly: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (parentSid) {
        await withTimeout(
          client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) }),
          TWILIO_OP_TIMEOUT_MS,
          "redirect guest parent",
        );
      }
    } catch (err2) {
      console.error("[emergency] guest parent redirect also failed:", err2);
    }
  }

  // 4. Add the emergency leg (911 in prod; 933 in dev/test).
  let emergencyCallSid: string | null = null;
  let dispatchError: string | null = null;
  try {
    const participant = await withTimeout(
      addEmergencyParticipant(client, confName, { from: callerId, to: dialTo }),
      TWILIO_OP_TIMEOUT_MS,
      "add emergency participant",
    );
    emergencyCallSid = participant.callSid;
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error("[emergency] add emergency participant failed:", err);
  }

  // 4b. Total dispatch failure with the agent already gone (no live agent leg AND
  //     no 911 leg) would leave the guest alone in a dead conference. Clear the
  //     stamp so /dial-result keeps the guest on the normal bridge instead of
  //     routing into the empty conference. When the agent IS in the conference
  //     they can relay verbally, so we keep that bridge intact.
  const guestStranded = Boolean(dispatchError) && !agentInConference;
  if (guestStranded) {
    await admin
      .from("calls")
      .update({ emergency_conference_name: null })
      .eq("id", callRow.id);
  }

  // 5. Log the incident (best-effort) + audit. A failed dispatch stays OPEN
  //    (it genuinely needs follow-up) but is prefixed DISPATCH FAILED in notes.
  const notes =
    [
      dispatchError ? "DISPATCH FAILED" : null,
      degradedNote,
      dispatchError ? `dispatch error: ${dispatchError}` : null,
      guestStranded
        ? "guest may be stranded — relay 911 verbally / have guest dial 911 directly"
        : null,
    ]
      .filter(Boolean)
      .join("; ") || null;
  const { error: incidentError } = await admin.from("incidents").insert({
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
  if (incidentError) {
    console.error("[emergency] failed to write incident row:", incidentError);
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "trigger_emergency",
    entityType: "call",
    entityId: callRow.id,
    details: {
      conferenceName: confName,
      dispatchedTo: dialTo,
      fallbackUsed,
      dispatchError,
      agentRedirected: agentInConference,
      guestStranded,
    },
  }).catch((err) => {
    console.error("[emergency] audit log failed:", err);
  });

  if (dispatchError) {
    return NextResponse.json(
      {
        error: "Emergency dispatch failed",
        conferenceName: confName,
        fallbackUsed,
        dispatchFailed: true,
        agentRedirected: agentInConference,
        guestStranded,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    conferenceName: confName,
    fallbackUsed,
    agentRedirected: agentInConference,
  });
}
