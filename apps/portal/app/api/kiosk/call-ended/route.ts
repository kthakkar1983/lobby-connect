import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { computeDurationSeconds } from "@/lib/calls/duration";

export const runtime = "nodejs";

const STATE_BY_REASON: Record<string, "COMPLETED" | "NO_ANSWER" | "FAILED"> = {
  completed: "COMPLETED",
  "no-answer": "NO_ANSWER",
  cancelled: "NO_ANSWER",
  failed: "FAILED",
};

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
    .select("id, property_id, state, answered_at")
    .eq("id", body.callId)
    .maybeSingle();

  if (!call || call.property_id !== verified.propertyId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const endedAt = new Date();
  const nextState = STATE_BY_REASON[body.reason ?? "completed"] ?? "COMPLETED";
  const durationSeconds = computeDurationSeconds(call.answered_at, endedAt.getTime());

  // Conditional on a still-active state so the kiosk-vs-agent finalize race is
  // safe: whichever side closes the call first wins, and a late writer (e.g. the
  // agent already marked it COMPLETED) no-ops instead of clobbering the row.
  await admin
    .from("calls")
    .update({
      state: nextState,
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq("id", body.callId)
    .eq("property_id", verified.propertyId)
    .in("state", ["RINGING", "IN_PROGRESS"]);

  return new NextResponse(null, { status: 204 });
}
