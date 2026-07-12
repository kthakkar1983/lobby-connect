import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { openBreak } from "@/lib/shifts/store";
import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";

export const runtime = "nodejs";

/**
 * Take a break (spec D6): BREAK = on duty, not working. Service-role (0012 guard).
 *
 * Quality-review fix: this must NOT be a second, ungated OFFLINE->live door.
 * Mirrors the D13 duty gate in POST /api/presence (route.ts) — the liveness
 * check and the write are one atomic conditional UPDATE: only a row that
 * isn't explicitly OFFLINE and whose heartbeat is still fresh may flip to
 * BREAK. A caller whose shift already lapsed/ended (or who never went on
 * duty) matches zero rows and gets 409, never a phantom live BREAK row.
 */
export async function POST(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - PRESENCE_STALE_AFTER_MS).toISOString();

  const { data: updated, error } = await admin
    .from("profiles")
    .update({ status: "BREAK", last_seen_at: nowIso })
    .eq("id", actor.userId)
    .neq("status", "OFFLINE")
    .gte("last_seen_at", staleCutoffIso)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not start break" }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Go on duty to take a break" }, { status: 409 });
  }

  await openBreak(admin, actor.userId);
  return new NextResponse(null, { status: 204 });
}
