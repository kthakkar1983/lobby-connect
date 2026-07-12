import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { openShift } from "@/lib/shifts/store";

export const runtime = "nodejs";

/**
 * "Go on duty" (spec §3.4/D13): the ONLY transition out of OFFLINE. Sets
 * AVAILABLE + a fresh heartbeat so the very next beat finds a live shift.
 * Service-role like every presence write (migration-0012 column guard); not
 * audited (presence writes never are).
 */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "AVAILABLE", last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);

  if (error) {
    return NextResponse.json({ error: "Could not go on duty" }, { status: 500 });
  }
  await openShift(admin, actor.userId, actor.operatorId);
  return new NextResponse(null, { status: 204 });
}
