import { NextResponse, after } from "next/server";

import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { stampKioskLiveness } from "@/lib/kiosk/stamp-liveness";
import { OUTBOUND_RING_WINDOW_MS } from "@lc/shared";
import type { CallStartResult } from "@lc/shared";

export const runtime = "nodejs";

/**
 * The kiosk's discovery poll (~3s while idle) — the reverse of the agent's
 * incoming-video poll/push. An agent-initiated outbound call (start-outbound-
 * video) has no push channel to the kiosk (no auth session to target), so the
 * kiosk must discover its own ring by polling. Also doubles as the kiosk's
 * liveness signal alongside heartbeat: every poll call, ringing or not, stamps
 * kiosks.last_seen_at so a kiosk that's merely idle (not dead) still reads
 * online between heartbeats.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Time-bound to the outbound ring window: a call the agent has already given
  // up on (or that outlived its window, headed for reaper cleanup) must not
  // resurface as a fresh-looking ring to a kiosk that polled late.
  const freshSince = new Date(Date.now() - OUTBOUND_RING_WINDOW_MS).toISOString();

  const { data: call } = await admin
    .from("calls")
    .select("id, agora_channel_name")
    .eq("property_id", verified.propertyId)
    .eq("channel", "VIDEO")
    .eq("direction", "OUTBOUND")
    .eq("state", "RINGING")
    .gte("ring_started_at", freshSince)
    .order("ring_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Best-effort, non-blocking liveness stamp — runs after the response via
  // after() (waitUntil-backed) so it never delays the poll response, and a
  // failure here must never fail the poll itself.
  after(() => {
    void stampKioskLiveness(admin, verified.propertyId).catch(() => {});
  });

  if (!call || !call.agora_channel_name) {
    return NextResponse.json(null);
  }

  const payload: CallStartResult = { callId: call.id, channelName: call.agora_channel_name };
  return NextResponse.json(payload);
}
