import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { closeOpenBreak } from "@/lib/shifts/store";

export const runtime = "nodejs";

/** Resume from a break (spec D6): back to AVAILABLE + close the open break row. */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "AVAILABLE", last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);
  if (error) return NextResponse.json({ error: "Could not resume" }, { status: 500 });

  await closeOpenBreak(admin, actor.userId, new Date().toISOString());
  return new NextResponse(null, { status: 204 });
}
