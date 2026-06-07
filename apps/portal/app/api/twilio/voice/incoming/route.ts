import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { planDial, type DialCandidate } from "@/lib/voice/plan-dial";
import {
  buildApologyTwiml,
  buildIncomingTwiml,
  buildNotInServiceTwiml,
} from "@/lib/voice/twiml";

export const runtime = "nodejs";
export const maxDuration = 20;

// Bound each Supabase query so a hung dependency aborts (→ apology TwiML in the
// catch below) well inside Twilio's webhook patience, instead of dead air.
const SUPABASE_TIMEOUT_MS = 2500;

const GREETING = "Connecting you to the front desk, one moment.";
const APOLOGY =
  "We're sorry, no one is available right now. Please try again or call us directly.";
const RING_TIMEOUT_SECONDS = 120;

function twimlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const signature = request.headers.get("x-twilio-signature");
    const url = publicUrlFromRequest(request);
    if (!validateTwilioSignature(signature, url, params)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }

    const to = params.To ?? "";
    const from = params.From ?? "";
    const callSid = params.CallSid ?? "";

    const admin = createAdminClient({ timeoutMs: SUPABASE_TIMEOUT_MS });

    // 1. Property by routing_did (active only).
    const { data: property } = await admin
      .from("properties")
      .select("id, operator_id, active, name")
      .eq("routing_did", to)
      .maybeSingle();

    if (!property || !property.active) {
      return twimlResponse(buildNotInServiceTwiml(APOLOGY));
    }

    // Best-effort: record that Twilio reached us (off the critical path).
    await recordHeartbeat(property.operator_id, "twilio_webhook");

    // 2. Idempotency: has this CallSid already been recorded?
    const { data: existing } = await admin
      .from("calls")
      .select("id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    // 3. Active primary agent (effective_until is null).
    const { data: assignment } = await admin
      .from("property_assignments")
      .select("primary_agent_id")
      .eq("property_id", property.id)
      .is("effective_until", null)
      .maybeSingle();

    let primaryAgent: DialCandidate | null = null;
    if (assignment?.primary_agent_id) {
      const { data: agent } = await admin
        .from("profiles")
        .select("id, twilio_identity, active")
        .eq("id", assignment.primary_agent_id)
        .maybeSingle();
      if (agent?.active && agent.twilio_identity) {
        primaryAgent = { id: agent.id, twilioIdentity: agent.twilio_identity };
      }
    }

    // 4. Admins accepting calls for this property.
    const { data: availRows } = await admin
      .from("admin_call_availability")
      .select("profile_id")
      .eq("property_id", property.id)
      .eq("accepting_calls", true);

    const availableAdmins: DialCandidate[] = [];
    const availIds = (availRows ?? []).map(
      (r: { profile_id: string }) => r.profile_id,
    );
    if (availIds.length > 0) {
      const { data: admins } = await admin
        .from("profiles")
        .select("id, twilio_identity, active, role, operator_id")
        .in("id", availIds)
        .eq("active", true)
        .eq("role", "ADMIN")
        .eq("operator_id", property.operator_id);
      for (const a of (admins ?? []) as Array<{
        id: string;
        twilio_identity: string | null;
      }>) {
        if (a.twilio_identity) {
          availableAdmins.push({ id: a.id, twilioIdentity: a.twilio_identity });
        }
      }
    }

    const targets = planDial({ primaryAgent, availableAdmins });

    // 5. Record the call (idempotent on CallSid); capture its id for the TwiML callId.
    let callId = existing?.id ?? "";
    if (!existing) {
      const { data: inserted } = await admin
        .from("calls")
        .insert({
          operator_id: property.operator_id,
          property_id: property.id,
          channel: "AUDIO",
          state: targets.length === 0 ? "NO_ANSWER" : "RINGING",
          twilio_call_sid: callSid,
          caller_number: from,
        })
        .select("id")
        .single();
      callId = inserted?.id ?? "";
    }

    // 6. Return TwiML (apology if nobody reachable, else parallel dial).
    const actionUrl = `${new URL(url).origin}/api/twilio/voice/dial-result`;
    return twimlResponse(
      buildIncomingTwiml(targets, {
        greeting: GREETING,
        timeoutSeconds: RING_TIMEOUT_SECONDS,
        actionUrl,
        apologyMessage: APOLOGY,
        callId,
        propertyName: property.name,
      }),
    );
  } catch (err) {
    console.error("[voice/incoming] unhandled error:", err);
    return twimlResponse(buildApologyTwiml(APOLOGY));
  }
}
