import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { resetPresenceAfterCall } from "@/lib/voice/call-state";
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
 *
 * Each row this sweep finalizes also gets its handler's presence reset
 * ON_CALL -> AVAILABLE (task_71d65b0a) — this is the crash/throttle case the
 * bug describes: the agent's own client is gone (or backgrounded behind a
 * foregrounded RustDesk session), so no client-side path ever ran the reset.
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

  // Two-pass reaper: gather candidates for BOTH sweeps, finalize every row, then
  // reset presence once per handler. Presence must not be reset per-row inside the
  // finalize maps — see PASS 2.

  // Video calls still IN_PROGRESS long past any plausible front-desk length →
  // the kiosk that owns finalization died mid-call. Stale by effective start
  // (answered_at ?? created_at); a real duration is computed at finalize.
  const { data: inProgressRows } = await admin
    .from("calls")
    .select("id, created_at, answered_at, handled_by_user_id")
    .eq("channel", "VIDEO")
    .eq("state", "IN_PROGRESS");
  const staleInProgress = ((inProgressRows ?? []) as Array<{
    id: string;
    created_at: string;
    answered_at: string | null;
    handled_by_user_id: string | null;
  }>).filter((row) => inProgressIsStale(row, now));

  // Video calls stuck ringing far past the 120s window → the kiosk died before
  // the agent answered (inbound), or an outbound call's ring went unanswered
  // and the agent's own end-video cancel never ran. Closed as NO_ANSWER (no
  // duration: never connected). Inbound rows are unclaimed while RINGING
  // (handled_by_user_id null), so their reset is a no-op; outbound rows carry the
  // originating agent, set at creation — need handled_by_user_id for the reset.
  const { data: ringingRows } = await admin
    .from("calls")
    .select("id, handled_by_user_id")
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .lt("ring_started_at", ringingBefore);
  const staleRinging = (ringingRows ?? []) as Array<{
    id: string;
    handled_by_user_id: string | null;
  }>;

  // PASS 1 — finalize every stale row (both sweeps) before touching presence.
  // Each per-row update is conditional on the row still being in its expected
  // state, so the reaper-vs-realtime finalize race stays first-writer-wins.
  await Promise.all([
    ...staleInProgress.map((row) =>
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
    ...staleRinging.map((row) =>
      admin
        .from("calls")
        .update({ state: "NO_ANSWER", ended_at: endedAt })
        .eq("id", row.id)
        .eq("state", "RINGING"),
    ),
  ]);

  // PASS 2 — one ownership-checked presence reset per DISTINCT handler. Doing this
  // only after every finalize above has committed means each ownership check
  // (resetPresenceAfterCall's "does this agent still have another live call?") sees
  // the true remaining-active set. Dropped naively into the per-row maps instead,
  // two stale rows for the same agent could each observe the OTHER still-live (its
  // finalize not yet committed) and both skip the reset — re-stranding the agent
  // ON_CALL, the very bug this route fixes. Best-effort: a failed reset is not
  // retried (the row is finalized, so the next run won't re-select it) and the
  // softphone heartbeat self-heals it.
  const handlerIds = [
    ...new Set(
      [...staleInProgress, ...staleRinging]
        .map((row) => row.handled_by_user_id)
        .filter((id): id is string => !!id),
    ),
  ];
  await Promise.all(handlerIds.map((id) => resetPresenceAfterCall(admin, id)));

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_reap_stale_calls")),
  );

  return NextResponse.json({ ok: true });
}
