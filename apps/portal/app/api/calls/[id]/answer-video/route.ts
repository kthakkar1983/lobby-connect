import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer } from "@/lib/voice/call-state";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import type { CallState } from "@lc/shared";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const call = await fetchOperatorCall<{
    id: string;
    state: CallState;
    agora_channel_name: string | null;
    operator_id: string;
  }>(actor, id, "id, state, agora_channel_name");
  if (call instanceof NextResponse) return call;

  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  const admin = createAdminClient();

  // Self-reporting UPDATE: zero rows returned means a concurrent accept beat us.
  const { data: claimed } = await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: actor.userId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("state", "RINGING")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // ON_CALL only for the winner — losers must not corrupt presence.
  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  return NextResponse.json({ channelName: call.agora_channel_name });
}
