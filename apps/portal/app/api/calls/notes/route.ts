import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    callId?: string;
    roomNumber?: string;
    notes?: string;
  };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Only the agent who handled the call may annotate it.
  await admin
    .from("calls")
    .update({ room_number: body.roomNumber ?? null, notes: body.notes ?? null })
    .eq("id", body.callId)
    .eq("handled_by_user_id", user.id);

  return new NextResponse(null, { status: 204 });
}
