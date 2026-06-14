import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import {
  reapCutoffs,
  inProgressIsStale,
  reapDurationSeconds,
} from "@/lib/calls/reaper";

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
  // Fail closed: the cron must present the secret. An unset secret is a
  // misconfiguration, not an invitation to run unauthenticated.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const { ringingBefore } = reapCutoffs(now);
  const endedAt = new Date(now).toISOString();
  const admin = createAdminClient();

  // Video calls still IN_PROGRESS long past any plausible front-desk length →
  // the kiosk that owns finalization died mid-call. Fetch candidates and close
  // each that is stale by its effective start (answered_at ?? created_at),
  // computing a real duration. The per-row update is conditional on still being
  // IN_PROGRESS so the reaper-vs-realtime finalize race stays first-writer-wins.
  const { data: inProgressRows } = await admin
    .from("calls")
    .select("id, created_at, answered_at")
    .eq("channel", "VIDEO")
    .eq("state", "IN_PROGRESS");
  const staleInProgress = ((inProgressRows ?? []) as Array<{
    id: string;
    created_at: string;
    answered_at: string | null;
  }>).filter((row) => inProgressIsStale(row, now));

  await Promise.all(
    staleInProgress.map((row) =>
      admin
        .from("calls")
        .update({
          state: "FAILED",
          ended_at: endedAt,
          duration_seconds: reapDurationSeconds(row.answered_at, now),
          flagged_for_review: true,
          notes: "Auto-closed by reaper: kiosk disconnected mid-call.",
        })
        .eq("id", row.id)
        .eq("state", "IN_PROGRESS"),
    ),
  );

  // Video calls stuck ringing far past the 120s window → kiosk died before the
  // agent answered. Close as NO_ANSWER (no duration: never connected).
  await admin
    .from("calls")
    .update({ state: "NO_ANSWER", ended_at: endedAt })
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .lt("ring_started_at", ringingBefore);

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_reap_stale_calls")),
  );

  return NextResponse.json({ ok: true });
}
