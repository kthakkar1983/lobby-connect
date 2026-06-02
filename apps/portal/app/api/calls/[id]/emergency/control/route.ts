import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  const { data: callRow } = await admin
    .from("calls")
    .select("id, operator_id, handled_by_user_id, emergency_conference_name, emergency_agent_call_sid")
    .eq("id", id)
    .maybeSingle();
  if (!callRow || callRow.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (callRow.handled_by_user_id !== user.id) {
    return NextResponse.json({ error: "Not the handling agent" }, { status: 403 });
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
