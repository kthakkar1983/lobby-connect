import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { parseVerifiedTwilioWebhook } from "@/lib/twilio/client";
import {
  APOLOGY_MESSAGE,
  twimlResponse,
  buildApologyTwiml,
  buildHangupTwiml,
} from "@/lib/voice/twiml";
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

// This read decides whether the guest's parent leg joins the emergency
// conference, so retry a transient blip instead of falling through to a hangup.
const READ_RETRY = { attempts: 3, delayMs: 150 } as const;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await parseVerifiedTwilioWebhook(request);
    if (parsed instanceof NextResponse) return parsed;
    const { params } = parsed;

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
      return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY_MESSAGE));
    }

    const currentTerminal = existing
      ? isTerminalState(existing.state)
      : false;

    const updatePayload: { ended_at: string; state?: CallState } = {
      ended_at: new Date().toISOString(),
    };
    if (!currentTerminal) updatePayload.state = finalState;

    await admin
      .from("calls")
      .update(updatePayload)
      .eq("twilio_call_sid", callSid);

    return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY_MESSAGE));
  } catch (err) {
    console.error("[voice/dial-result] unhandled error:", err);
    return twimlResponse(buildApologyTwiml(APOLOGY_MESSAGE));
  }
}
