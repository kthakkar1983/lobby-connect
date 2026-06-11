import { NextResponse } from "next/server";
import type { CallState } from "@lc/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { canAnswer, claimCall } from "@/lib/voice/call-state";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  // OWNER is rejected: owners are read-only (07a spec) and do not participate
  // in live call handling. This mirrors the same gate on /api/calls/[id]/answer-video.
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const body = (await request.json().catch(() => ({}))) as { callId?: string };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  const call = await fetchOperatorCall<{ id: string; state: CallState }>(
    actor,
    body.callId,
    "id, state",
  );
  if (call instanceof NextResponse) return call;

  // Fast-path: if the state is already non-RINGING, no need to attempt the claim.
  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  const admin = createAdminClient();

  // Race-safe atomic claim: UPDATE ... WHERE state='RINGING', returns rows only
  // if this caller wins. A concurrent winner returns empty rows → loser gets 409
  // and does NOT stamp ON_CALL, preventing presence corruption.
  const won = await claimCall(admin, body.callId, actor.userId);
  if (!won) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  return new NextResponse(null, { status: 204 });
}
