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

export const runtime = "nodejs";

const APOLOGY =
  "We're sorry, no one is available right now. Please try again or call us directly.";

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
    const { data: existing } = await admin
      .from("calls")
      .select("state")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

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
