import { NextResponse, after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer, claimCall, ACTIVE_CALL_STATES } from "@/lib/voice/call-state";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { requireOnDuty } from "@/lib/shifts/gate";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
import { sendCallPush } from "@/lib/push/send";
import type { CallState } from "@lc/shared";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  // Hard gate (spec §7.1): no answering a call without a live, non-break shift.
  const admin = createAdminClient();
  const gate = await requireOnDuty(admin, actor.userId);
  if (gate) return gate;

  const call = await fetchOperatorCall<{
    id: string;
    state: CallState;
    agora_channel_name: string | null;
    operator_id: string;
    property_id: string;
  }>(actor, id, "id, state, agora_channel_name, property_id");
  if (call instanceof NextResponse) return call;

  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // One call at a time — a human handles one guest at a time (mirrors
  // start-outbound-video's row-based guard). Keys on live call ROWS
  // (handled_by_user_id), not profiles.status, so a stale ON_CALL from a missed
  // presence reset (task_71d65b0a) can't false-block. `.neq("id", id)` excludes
  // the call being answered: an inbound RINGING row is unclaimed (handled_by null)
  // so it wouldn't match anyway, but the exclusion keeps the guard exactly "any
  // OTHER active call". Best-effort app-layer guard (same TOCTOU caveat as
  // start-outbound): the claimCall UPDATE below is the atomic per-call backstop.
  const { data: existingActive } = await admin
    .from("calls")
    .select("id")
    .eq("handled_by_user_id", actor.userId)
    .in("state", ACTIVE_CALL_STATES)
    .neq("id", id)
    .limit(1);
  if (existingActive && existingActive.length > 0) {
    return NextResponse.json({ error: "You are already on a call" }, { status: 409 });
  }

  const won = await claimCall(admin, id, actor.userId);
  if (!won) return NextResponse.json({ error: "Already answered" }, { status: 409 });

  // ON_CALL only for the winner — losers must not corrupt presence.
  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);

  // The claim removes this call from every other agent's incoming list. after()
  // (waitUntil-backed) guarantees the broadcast fires before the function freezes.
  after(() => {
    void broadcastCallsChanged(actor.operatorId);
    void sendCallPush(admin, {
      type: "call-cleared",
      callId: id,
      channel: "VIDEO",
      propertyId: call.property_id,
      propertyName: "",
    });
  });

  return NextResponse.json({ channelName: call.agora_channel_name });
}
