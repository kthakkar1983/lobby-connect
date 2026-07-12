import { NextResponse, after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer, claimCall } from "@/lib/voice/call-state";
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
