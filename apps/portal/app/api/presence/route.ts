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

  await admin
    .from("profiles")
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);

  return new NextResponse(null, { status: 204 });
}
