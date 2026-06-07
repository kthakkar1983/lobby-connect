import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLiveStatus } from "@/lib/voice/presence";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const { data: liveVideo } = await admin
      .from("calls")
      .select("id")
      .eq("channel", "VIDEO")
      .eq("state", "IN_PROGRESS")
      .eq("handled_by_user_id", user.id)
      .limit(1);
    if (liveVideo && liveVideo.length > 0) {
      status = "ON_CALL";
    }
  }

  await admin
    .from("profiles")
    .update({ status, last_seen_at: new Date().toISOString() })
    .eq("id", user.id);

  return new NextResponse(null, { status: 204 });
}
