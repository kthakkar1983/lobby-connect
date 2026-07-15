import { NextResponse, after } from "next/server";

import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimOutboundByKiosk } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";

export const runtime = "nodejs";

/**
 * The kiosk's answer for an agent-initiated OUTBOUND call — the reverse of the
 * agent's answer-video. State-guarded RINGING -> IN_PROGRESS via
 * claimOutboundByKiosk, which (unlike claimCall) does NOT touch
 * handled_by_user_id: for an outbound call that's already the originating
 * agent and must be preserved. No presence write here — the originating agent
 * already went ON_CALL when the call was placed (start-outbound-video).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { callId?: string };
  if (!body.callId) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const claimed = await claimOutboundByKiosk(admin, body.callId, verified.propertyId);
  if (!claimed) {
    // No longer RINGING: agent cancelled, timed out, or a double-tap lost the race.
    return NextResponse.json({ error: "Call is no longer available" }, { status: 409 });
  }

  // after() (waitUntil-backed) guarantees the broadcast fires before the
  // function freezes; a bare `void` detached fetch is not guaranteed to run.
  after(() => {
    void broadcastCallsChanged(claimed.operatorId);
  });

  return NextResponse.json({ channelName: claimed.channelName });
}
