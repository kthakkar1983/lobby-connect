import { NextResponse } from "next/server";

import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { getTwilioRestClient } from "@/lib/twilio/client";

export const runtime = "nodejs";

type Action = "mute" | "unmute" | "leave";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: Action };
  const action = body.action;
  if (action !== "mute" && action !== "unmute" && action !== "leave") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
  if (actor instanceof NextResponse) return actor;

  const callRow = await fetchOperatorCall<{
    id: string;
    operator_id: string;
    state: string;
    handled_by_user_id: string | null;
    emergency_conference_name: string | null;
    emergency_agent_call_sid: string | null;
  }>(
    actor,
    id,
    "id, operator_id, state, handled_by_user_id, emergency_conference_name, emergency_agent_call_sid",
  );
  if (callRow instanceof NextResponse) return callRow;
  if (callRow.handled_by_user_id !== actor.userId) {
    return NextResponse.json({ error: "Not the handling agent" }, { status: 403 });
  }
  // Only a live call can be conference-controlled. A finalized call's agent leg
  // is already gone, so mutating it is a wasted (and possibly stale) Twilio call.
  if (callRow.state !== "IN_PROGRESS") {
    return NextResponse.json({ error: "Call is not in progress" }, { status: 409 });
  }
  if (!callRow.emergency_conference_name) {
    return NextResponse.json({ error: "Call is not in an emergency conference" }, { status: 409 });
  }

  // Fallback path may have dropped the agent (no agent leg in the conference) —
  // nothing to control, but let the client reset cleanly.
  if (!callRow.emergency_agent_call_sid) {
    return NextResponse.json({ ok: true, noAgentLeg: true });
  }

  const client = getTwilioRestClient();
  try {
    const participant = client
      .conferences(callRow.emergency_conference_name)
      .participants(callRow.emergency_agent_call_sid);
    if (action === "leave") {
      await participant.remove();
    } else {
      await participant.update({ muted: action === "mute" });
    }
  } catch (err) {
    console.error("[emergency/control] twilio error:", err);
    return NextResponse.json({ error: "Conference control failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
