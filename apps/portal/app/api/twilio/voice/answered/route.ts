import { NextResponse } from "next/server";
import type { CallState } from "@lc/shared";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { canAnswer } from "@/lib/voice/call-state";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
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

  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  const admin = createAdminClient();

  // Conditional on still-RINGING (second .eq) to lose the answer race safely.
  await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: actor.userId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", body.callId)
    .eq("state", "RINGING");

  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  return new NextResponse(null, { status: 204 });
}
