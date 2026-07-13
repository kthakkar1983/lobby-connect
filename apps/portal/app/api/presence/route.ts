import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { isLiveStatus } from "@/lib/voice/presence";
import { REAP_IN_PROGRESS_AFTER_MS } from "@lc/shared";

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

  const nowIso = new Date().toISOString();

  // BREAK preservation (finding #1 — HOISTED above the ON_CALL branch). A
  // heartbeat must NEVER clobber a deliberate BREAK, no matter which live status
  // the beat carries. The softphone only ever intends AVAILABLE/AWAY/ON_CALL (it
  // has no notion of BREAK), but two paths would otherwise overwrite a break the
  // agent deliberately started:
  //   - an AVAILABLE/AWAY beat → the normal refresh below (back to AVAILABLE/AWAY);
  //   - an ON_CALL beat — a live audio call posting ON_CALL directly, OR an
  //     AVAILABLE beat UPGRADED to ON_CALL by the live-video check above → the
  //     unconditional ON_CALL write below.
  // Either overwrite leaks the open shift_breaks row (it then closes only at
  // end-of-shift, recording a bogus break duration) AND makes Resume 409
  // (Resume is gated on status=BREAK). So this atomic conditional UPDATE runs
  // FIRST for every beat: it refreshes last_seen_at only (never status) while
  // the row is BREAK, and returns without falling through. No staleness guard:
  // a beat during a break keeps the break alive regardless of tab throttling —
  // a break ends only via Resume, End shift, or the cron sweep (which closes the
  // open break via closeOpenShiftForUser), never by a lapsed heartbeat.
  const { data: preserved, error: preserveError } = await admin
    .from("profiles")
    .update({ last_seen_at: nowIso })
    .eq("id", actor.userId)
    .eq("status", "BREAK")
    .select("id");
  // FAIL OPEN on a real DB error, same posture as the refresh check below: do
  // nothing further this beat rather than risk clobbering BREAK.
  if (preserveError) return new NextResponse(null, { status: 204 });
  if (preserved && preserved.length > 0) return new NextResponse(null, { status: 204 });

  // D13 ON_CALL exception (spec §3.4): a live call outranks the duty gate —
  // raw OFFLINE included (the accepted two-tab edge) — so a >90s network blip
  // mid-call can't dump the agent off duty. Exactly the pre-D13 write. A fresh
  // BREAK was already preserved above, so this can no longer clobber one.
  if (status === "ON_CALL") {
    await admin
      .from("profiles")
      .update({ status, last_seen_at: nowIso })
      .eq("id", actor.userId);
    return new NextResponse(null, { status: 204 });
  }

  // D13 duty gate, reconciled with the ring/push architecture: an AVAILABLE/AWAY
  // beat REFRESHES a live shift. One atomic conditional UPDATE (no read-then-write
  // race): match any row that isn't explicitly OFFLINE — NO staleness guard. A
  // beat proves the browser is alive, and a throttled/frozen portal tab is the
  // NORMAL working posture here (heads-down in RustDesk), so a stale heartbeat
  // must NOT end the shift — it refreshes. A shift ends only via End shift
  // (manual), the daily cron sweep of a tab that stopped beating entirely
  // (lapsed), or the 12h session cap (capped). The `.neq OFFLINE` is what stops a
  // beat from resurrecting an ENDED shift — go-on-duty stays the only door in.
  const { data: refreshed, error: refreshError } = await admin
    .from("profiles")
    .update({ status, last_seen_at: nowIso })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE")
    .select("id");

  // FAIL OPEN on a real DB error (spec §3.4 + the lib/push/targets.ts rule: a
  // blip must never end a live shift): behave like a fire-and-forget beat — 204,
  // no verdict.
  if (refreshError) return new NextResponse(null, { status: 204 });

  // Refreshed a live shift (any non-OFFLINE row, stale or fresh).
  if (refreshed && refreshed.length > 0) return new NextResponse(null, { status: 204 });

  // Zero rows = the row is OFFLINE = the shift is genuinely over (ended, or
  // cron-swept after the tab stopped beating). A beat can never reopen it. Tell
  // the client so its header converges to off-duty.
  return NextResponse.json({ onDuty: false });
}

/**
 * Duty hydration (D13): the client inits onDuty + the Accepting toggle from the
 * SERVER instead of assuming true on mount. onDuty is the raw server status
 * (only OFFLINE is off duty). AGENT/ADMIN only — this is a softphone endpoint.
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
  // Duty is RAW-STATUS (mirrors the canDoWork gate): a stale heartbeat is normal
  // working state and must not hydrate an on-duty agent OFF duty. Only an explicit
  // OFFLINE (ended / cron-swept) is off duty; her next beat refreshes last_seen.
  const onDuty = status !== "OFFLINE";

  let shiftStartedAt: string | null = null;
  if (onDuty) {
    const { data: open, error: shiftReadError } = await admin
      .from("shifts")
      .select("started_at")
      .eq("user_id", actor.userId)
      .is("ended_at", null)
      .maybeSingle();
    // A transient read error is indistinguishable from "no open shift" (both
    // leave `open` falsy) — fail open (shiftStartedAt just stays null, same as
    // store.ts's closeOpenShiftForUser) but log it so a real DB error doesn't
    // vanish silently. See store.ts for the identical rationale.
    if (shiftReadError) {
      console.error("[presence] GET: open-shift read failed", shiftReadError);
    }
    shiftStartedAt = open?.started_at ?? null;
  }

  return NextResponse.json({
    onDuty,
    accepting: status !== "AWAY",
    onBreak: status === "BREAK",
    shiftStartedAt,
  });
}
