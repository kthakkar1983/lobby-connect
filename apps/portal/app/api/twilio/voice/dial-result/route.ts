import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { buildApologyTwiml, buildHangupTwiml } from "@/lib/voice/twiml";
import { resolveDialResult } from "@/lib/voice/result";

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
  await admin
    .from("calls")
    .update({ state: finalState, ended_at: new Date().toISOString() })
    .eq("twilio_call_sid", callSid);

  return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY));
}
