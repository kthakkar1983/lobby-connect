import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { buildApologyTwiml, buildHangupTwiml } from "@/lib/voice/twiml";
import {
  resolveDialResult,
  isTerminalState,
  type CallState,
} from "@/lib/voice/result";
import {
  shouldRouteToEmergencyConference,
  buildConferenceTwiml,
} from "@/lib/emergency/conference";
import { readWithRetry } from "@/lib/db/read-with-retry";

export const runtime = "nodejs";

const APOLOGY =
  "We're sorry, no one is available right now. Please try again or call us directly.";

// This read decides whether the guest's parent leg joins the emergency
// conference, so retry a transient blip instead of falling through to a hangup.
const READ_RETRY = { attempts: 3, delayMs: 150 } as const;

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

    const callSid = params.CallSid ?? "";
    const { finalState, hangup } = resolveDialResult(params.DialCallStatus ?? "");

    const admin = createAdminClient();

    // Terminal-state guard: don't overwrite a state that's already terminal.
    // Retry on a transient error — see READ_RETRY above.
    const { data: existing, error: readError } = await readWithRetry(
      () =>
        admin
          .from("calls")
          .select("state, emergency_conference_name")
          .eq("twilio_call_sid", callSid)
          .maybeSingle(),
      READ_RETRY,
    );

    // Emergency: the agent leg was redirected into a conference, so this parent
    // (guest) leg must join the same conference instead of hanging up.
    if (existing && shouldRouteToEmergencyConference(existing)) {
      return twimlResponse(buildConferenceTwiml(existing.emergency_conference_name as string));
    }

    // Still unreadable after retries: we cannot tell whether this call is
    // mid-911, so DON'T write a terminal state — clobbering an active emergency
    // would be catastrophic. /status + the reaper finalize a genuinely-ended
    // normal call. Play the safe default audio only.
    if (readError) {
      console.error("[voice/dial-result] read failed after retries:", readError);
      return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY));
    }

    const currentTerminal = existing
      ? isTerminalState(existing.state as CallState)
      : false;

    const updatePayload: { ended_at: string; state?: CallState } = {
      ended_at: new Date().toISOString(),
    };
    if (!currentTerminal) updatePayload.state = finalState;

    await admin
      .from("calls")
      .update(updatePayload)
      .eq("twilio_call_sid", callSid);

    return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY));
  } catch (err) {
    console.error("[voice/dial-result] unhandled error:", err);
    return twimlResponse(buildApologyTwiml(APOLOGY));
  }
}
