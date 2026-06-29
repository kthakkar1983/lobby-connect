import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { finalizeCallPayload, ACTIVE_CALL_STATES, resolveFinalState } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    callId?: string;
    reason?: string;
  };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, state, answered_at, operator_id")
    .eq("id", body.callId)
    .maybeSingle();

  if (!call || call.property_id !== verified.propertyId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const endedAt = new Date();
  // An answered call (answered_at set) can never be NO_ANSWER — a "cancelled"/
  // "no-answer" reason on an already-claimed call means it connected then ended.
  const nextState = resolveFinalState(body.reason, call.answered_at != null);

  // Conditional on a still-active state so the kiosk-vs-agent finalize race is
  // safe: whichever side closes the call first wins, and a late writer (e.g. the
  // agent already marked it COMPLETED) no-ops instead of clobbering the row.
  await admin
    .from("calls")
    .update(finalizeCallPayload(nextState, call.answered_at, endedAt))
    .eq("id", body.callId)
    .eq("property_id", verified.propertyId)
    .in("state", ACTIVE_CALL_STATES);

  void broadcastCallsChanged(call.operator_id);

  return new NextResponse(null, { status: 204 });
}
