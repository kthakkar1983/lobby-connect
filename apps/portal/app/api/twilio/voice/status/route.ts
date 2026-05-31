import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import {
  mapFinalCallState,
  isTerminalState,
  parseDurationSeconds,
  type CallState,
} from "@/lib/voice/result";

export const runtime = "nodejs";

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
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("calls")
      .select("state")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    const duration = parseDurationSeconds(params.CallDuration);
    const mapped = mapFinalCallState(params.CallStatus ?? "");

    const updates: {
      ended_at: string;
      duration_seconds?: number;
      state?: CallState;
      answered_at?: string;
    } = { ended_at: new Date().toISOString() };

    if (duration !== null) updates.duration_seconds = duration;

    // Only set state if we have a terminal mapping AND the row isn't already terminal.
    const currentTerminal = existing
      ? isTerminalState(existing.state as CallState)
      : false;
    if (mapped && !currentTerminal) {
      updates.state = mapped;
      if (mapped === "COMPLETED") updates.answered_at = new Date().toISOString();
    }

    await admin.from("calls").update(updates).eq("twilio_call_sid", callSid);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[voice/status] unhandled error:", err);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
