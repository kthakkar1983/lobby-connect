import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";

export const runtime = "nodejs";

/**
 * "End shift" (spec D6): flip the caller's presence to OFFLINE immediately so the
 * admin fleet reads true without waiting for staleness. Not audited — presence
 * writes never are.
 *
 * The write MUST be service-role: the migration-0012 column-guard trigger blocks
 * a non-admin from self-updating `status` (only `full_name` is self-editable), so
 * a user-scoped client would be rejected. This mirrors the sibling heartbeat
 * route (all presence writes go through the admin client).
 */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .eq("id", actor.userId);

  if (error) {
    return NextResponse.json({ error: "Could not end shift" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
