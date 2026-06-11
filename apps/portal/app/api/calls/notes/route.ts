import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

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
    .eq("handled_by_user_id", actor.userId);

  return new NextResponse(null, { status: 204 });
}
