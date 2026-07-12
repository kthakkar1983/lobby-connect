import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { openBreak } from "@/lib/shifts/store";

export const runtime = "nodejs";

/** Take a break (spec D6): BREAK = on duty, not working. Service-role (0012 guard). */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: "BREAK", last_seen_at: new Date().toISOString() })
    .eq("id", actor.userId);
  if (error) return NextResponse.json({ error: "Could not start break" }, { status: 500 });

  await openBreak(admin, actor.userId);
  return new NextResponse(null, { status: 204 });
}
