import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { isLiveShift, isLiveStatus } from "@/lib/voice/presence";
import { PRESENCE_STALE_AFTER_MS, REAP_IN_PROGRESS_AFTER_MS } from "@lc/shared";
import { closeOpenShiftForUser } from "@/lib/shifts/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  // OWNER kept in allow for behavior-parity (route had no role gate pre-seam); no
  // OWNER client ever calls this heartbeat in practice. OWNER-reject is deferred.
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !isLiveStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The softphone derives AVAILABLE from the audio phase only, so a heartbeat
  // would clobber a VIDEO agent's ON_CALL status mid-call. If the caller is on
  // a live video call, keep them ON_CALL instead of downgrading. AWAY and
  // ON_CALL posts are written as-is.
  let status = body.status;
  if (status === "AVAILABLE") {
    // Only a *fresh* live video call counts. A leaked IN_PROGRESS row (crashed
    // kiosk, both finalizers missed) older than the reaper's cutoff is a phantom
    // and must not pin the agent ON_CALL — mirrors the staleness-bound pattern from incoming-video/route.ts.
    const freshSince = new Date(Date.now() - REAP_IN_PROGRESS_AFTER_MS).toISOString();
    const { data: liveVideo } = await admin
      .from("calls")
      .select("id")
      .eq("channel", "VIDEO")
      .eq("state", "IN_PROGRESS")
      .eq("handled_by_user_id", actor.userId)
      .gte("answered_at", freshSince)
      .limit(1);
    if (liveVideo && liveVideo.length > 0) {
      status = "ON_CALL";
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // D13 ON_CALL exception (spec §3.4): a live call outranks the duty gate —
  // raw OFFLINE included (the accepted two-tab edge) — so a >90s network blip
  // mid-call can't dump the agent off duty. Exactly the pre-D13 write.
  if (status === "ON_CALL") {
    await admin
      .from("profiles")
      .update({ status, last_seen_at: nowIso })
      .eq("id", actor.userId);
    return new NextResponse(null, { status: 204 });
  }

  // D13 duty gate: an AVAILABLE/AWAY beat may only REFRESH a live shift. The
  // liveness check and the write are one atomic conditional UPDATE (no
  // read-then-write race): match only a row that isn't explicitly OFFLINE and
  // whose heartbeat is still fresh. Zero rows = the shift is over — only
  // /api/presence/go-on-duty starts one.
  const staleCutoffIso = new Date(nowMs - PRESENCE_STALE_AFTER_MS).toISOString();

  // BREAK preservation (quality-review follow-up to Task 9): the softphone
  // heartbeat only ever intends AVAILABLE/AWAY/ON_CALL — it has no notion of
  // BREAK yet (a future task wires the take-break/resume UI onto it). Without
  // this, a beat landing while the row is BREAK would silently overwrite it
  // back to AVAILABLE/AWAY: the shift_breaks row would leak open forever and
  // the agent would become dialable/video-reachable again without ever
  // clicking Resume. Mirrors the ON_CALL exception above with its own atomic
  // conditional UPDATE that only refreshes last_seen_at (never touches
  // status) while the row is still (fresh) BREAK. A STALE BREAK row matches
  // nothing here and falls through to the normal gate below, which lapses it
  // exactly like any other stale live status (closing the open break too, via
  // closeOpenShiftForUser).
  if (status === "AVAILABLE" || status === "AWAY") {
    const { data: preserved, error: preserveError } = await admin
      .from("profiles")
      .update({ last_seen_at: nowIso })
      .eq("id", actor.userId)
      .eq("status", "BREAK")
      .gte("last_seen_at", staleCutoffIso)
      .select("id");
    // FAIL OPEN on a real DB error, same posture as the refresh check below:
    // do nothing further this beat rather than risk clobbering BREAK.
    if (preserveError) return new NextResponse(null, { status: 204 });
    if (preserved && preserved.length > 0) return new NextResponse(null, { status: 204 });
  }

  const { data: refreshed, error: refreshError } = await admin
    .from("profiles")
    .update({ status, last_seen_at: nowIso })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE")
    .gte("last_seen_at", staleCutoffIso)
    .select("id");

  // FAIL OPEN on a real DB error (spec §3.4 + the lib/push/targets.ts rule: a
  // blip must never end a live shift): behave like the pre-D13 fire-and-forget
  // beat — 204, no gate verdict, no lapse-persist. Only a clean zero-row match
  // means the shift is actually over.
  if (refreshError) return new NextResponse(null, { status: 204 });

  if (refreshed && refreshed.length > 0) return new NextResponse(null, { status: 204 });

  // Gated. If the shift LAPSED (raw status still live, heartbeat stale), persist
  // OFFLINE now — the event-driven version of the daily sweep — so video push
  // stops targeting a lapsed shift immediately. Staleness is re-checked in the
  // WHERE so this can never clobber a concurrent go-on-duty; last_seen_at is
  // untouched. A raw-OFFLINE row matches nothing (nothing to persist).
  const { data: lapsed } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE")
    .lt("last_seen_at", staleCutoffIso)
    .select("id, last_seen_at");

  if (lapsed && lapsed.length > 0) {
    await closeOpenShiftForUser(
      admin,
      actor.userId,
      lapsed[0]?.last_seen_at ?? staleCutoffIso,
      "auto",
    );
  }

  return NextResponse.json({ onDuty: false });
}

/**
 * Duty hydration (D13): the client inits onDuty + the Accepting toggle from the
 * SERVER instead of assuming true on mount. Server clock does the staleness math
 * (no client clock skew). AGENT/ADMIN only — this is a softphone endpoint.
 */
export async function GET(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("status, last_seen_at")
    .eq("id", actor.userId)
    .maybeSingle();

  // Surface a read error as 500 so the client's !res.ok path FAILS OPEN
  // (spec §3.4: a blip must never hydrate a live agent off duty). A clean
  // null row (profile deleted mid-request) still reads as off duty below.
  if (error) {
    return NextResponse.json({ error: "Could not read duty state" }, { status: 500 });
  }

  const status = data?.status ?? "OFFLINE";
  return NextResponse.json({
    onDuty: isLiveShift(status, data?.last_seen_at ?? null, Date.now()),
    accepting: status !== "AWAY",
  });
}
