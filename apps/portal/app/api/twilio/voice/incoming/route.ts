import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { RING_WINDOW_SECONDS } from "@lc/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import {
  parseVerifiedTwilioWebhook,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { planDial, type DialCandidate } from "@/lib/voice/plan-dial";
import { isReachableForDial } from "@/lib/voice/presence";
import {
  APOLOGY_MESSAGE,
  twimlResponse,
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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await parseVerifiedTwilioWebhook(request);
    if (parsed instanceof NextResponse) return parsed;
    const { params } = parsed;

    const to = params.To ?? "";
    const from = params.From ?? "";
    const callSid = params.CallSid ?? "";

    const admin = createAdminClient({ timeoutMs: SUPABASE_TIMEOUT_MS });

    // 1. Property gate (everything needs operator_id / property.id).
    const { data: property } = await admin
      .from("properties")
      .select("id, operator_id, active, name")
      .eq("routing_did", to)
      .maybeSingle();
    if (!property || !property.active) {
      return twimlResponse(buildNotInServiceTwiml(APOLOGY_MESSAGE));
    }

    // Best-effort heartbeat — detached so it never sits on the guest's critical path.
    void recordHeartbeat(property.operator_id, "twilio_webhook").catch(() => {});

    // 2–4. Independent reads in parallel. `nowMs` gates dial targets on a fresh
    // heartbeat (resolve*), so an offline/away agent isn't dialed.
    const nowMs = Date.now();
    const [existing, primaryAgent, availableAdmins] = await Promise.all([
      admin
        .from("calls")
        .select("id")
        .eq("twilio_call_sid", callSid)
        .maybeSingle()
        .then((r) => r.data as { id: string } | null),
      resolvePrimaryAgent(admin, property.id, nowMs),
      resolveAvailableAdmins(admin, property.id, property.operator_id, nowMs),
    ]);

    const { targets, droppedCount } = planDial({ primaryAgent, availableAdmins });
    if (droppedCount > 0) {
      Sentry.captureMessage(
        `Dial fan-out capped at ${targets.length}; ${droppedCount} candidate(s) dropped (property ${property.id})`,
        "warning",
      );
    }
    if (targets.length === 0) {
      // No reachable softphone at call time — none assigned/accepting, or all
      // offline/away. The guest gets the apology either way; surface it so this
      // dead-end stops being silent (it's the symptom Kumar hit on the pilot).
      Sentry.captureMessage(
        `Incoming call with no reachable agents (property ${property.id}, callSid ${callSid})`,
        "warning",
      );
    }

    // 5. Record the call (idempotent on CallSid).
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

    // 6. TwiML.
    const actionUrl = `${new URL(publicUrlFromRequest(request)).origin}/api/twilio/voice/dial-result`;
    return twimlResponse(
      buildIncomingTwiml(targets, {
        greeting: GREETING,
        timeoutSeconds: RING_WINDOW_SECONDS,
        actionUrl,
        apologyMessage: APOLOGY_MESSAGE,
        callId,
        propertyName: property.name,
      }),
    );
  } catch (err) {
    console.error("[voice/incoming] unhandled error:", err);
    return twimlResponse(buildApologyTwiml(APOLOGY_MESSAGE));
  }
}

type Admin = ReturnType<typeof createAdminClient>;

// Today's exact query logic, lifted into named readers so the two 2-deep chains
// run in parallel. Behavior-identical to the prior inline blocks.
async function resolvePrimaryAgent(admin: Admin, propertyId: string, nowMs: number): Promise<DialCandidate | null> {
  const { data: assignment } = await admin
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null)
    .maybeSingle();
  if (!assignment?.primary_agent_id) return null;
  const { data: agent } = await admin
    .from("profiles")
    .select("id, twilio_identity, active, status, last_seen_at")
    .eq("id", assignment.primary_agent_id)
    .maybeSingle();
  // Presence-gate: only dial an agent whose softphone is actually reachable
  // (AVAILABLE + fresh heartbeat). Dialing an offline agent wastes the call's
  // dial slot — at the pilot's Twilio concurrency limit it black-holes the call.
  if (
    agent?.active &&
    agent.twilio_identity &&
    isReachableForDial(agent.status ?? "OFFLINE", agent.last_seen_at, nowMs)
  ) {
    return { id: agent.id, twilioIdentity: agent.twilio_identity };
  }
  return null;
}

async function resolveAvailableAdmins(admin: Admin, propertyId: string, operatorId: string, nowMs: number): Promise<DialCandidate[]> {
  const { data: availRows } = await admin
    .from("admin_call_availability")
    .select("profile_id")
    .eq("property_id", propertyId)
    .eq("accepting_calls", true);
  const ids = (availRows ?? []).map((r: { profile_id: string }) => r.profile_id);
  if (ids.length === 0) return [];
  const { data: admins } = await admin
    .from("profiles")
    .select("id, twilio_identity, active, role, operator_id, status, last_seen_at")
    .in("id", ids)
    .eq("active", true)
    .eq("role", "ADMIN")
    .eq("operator_id", operatorId);
  const out: DialCandidate[] = [];
  // Presence-gate (see resolvePrimaryAgent): skip admins whose softphone isn't reachable.
  for (const a of (admins ?? []) as Array<{
    id: string;
    twilio_identity: string | null;
    status: string | null;
    last_seen_at: string | null;
  }>) {
    if (a.twilio_identity && isReachableForDial(a.status ?? "OFFLINE", a.last_seen_at, nowMs)) {
      out.push({ id: a.id, twilioIdentity: a.twilio_identity });
    }
  }
  return out;
}
