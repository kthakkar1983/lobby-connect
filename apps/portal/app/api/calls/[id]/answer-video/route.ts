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
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
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

  // Conditional on still-RINGING to lose the answer race safely.
  await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: user.id,
      answered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("state", "RINGING");

  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", user.id);

  return NextResponse.json({ channelName: call.agora_channel_name });
}
