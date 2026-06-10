import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer } from "@/lib/voice/call-state";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

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
    .select("id, operator_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }
  // Owners are read-only (07a spec): a publisher token would let them appear,
  // with A/V, inside a guest's live call. Reject before touching the call.
  if (me.role === "OWNER") {
    return NextResponse.json({ error: "Owners cannot join live calls" }, { status: 403 });
  }

  const { data: call } = await admin
    .from("calls")
    .select("id, state, operator_id, agora_channel_name")
    .eq("id", id)
    .maybeSingle();
  if (!call || call.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // Self-reporting UPDATE: zero rows returned means a concurrent accept beat us.
  const { data: claimed } = await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: user.id,
      answered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("state", "RINGING")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // ON_CALL only for the winner — losers must not corrupt presence.
  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", user.id);

  return NextResponse.json({ channelName: call.agora_channel_name });
}
