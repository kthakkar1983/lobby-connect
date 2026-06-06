import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { reapCutoffs } from "@/lib/calls/reaper";

export const runtime = "nodejs";

/**
 * Backstop for the kiosk-owned video-call finalizer. If a kiosk browser dies
 * mid-call it never calls `/api/kiosk/call-ended`, leaving the row stuck
 * RINGING/IN_PROGRESS forever. The agent-side finalizer closes most of these in
 * real time; this cron sweeps anything that slips through (e.g. agent + kiosk
 * both gone). AUDIO calls are finalized by Twilio webhooks, so they are never
 * touched here.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = Date.now();
  const { inProgressBefore, ringingBefore } = reapCutoffs(now);
  const endedAt = new Date(now).toISOString();
  const admin = createAdminClient();

  // Answered video calls live past any plausible front-desk length → the kiosk
  // that owns finalization died mid-call. Close as FAILED and flag for review.
  await admin
    .from("calls")
    .update({
      state: "FAILED",
      ended_at: endedAt,
      flagged_for_review: true,
      notes: "Auto-closed by reaper: kiosk disconnected mid-call.",
    })
    .eq("channel", "VIDEO")
    .eq("state", "IN_PROGRESS")
    .lt("answered_at", inProgressBefore);

  // Video calls stuck ringing far past the 120s window → kiosk died before the
  // agent answered. Close as NO_ANSWER.
  await admin
    .from("calls")
    .update({ state: "NO_ANSWER", ended_at: endedAt })
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .lt("ring_started_at", ringingBefore);

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  for (const op of operators ?? []) {
    await recordHeartbeat(op.id, "cron_reap_stale_calls");
  }

  return NextResponse.json({ ok: true });
}
