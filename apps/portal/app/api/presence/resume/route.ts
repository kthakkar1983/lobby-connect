import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { closeOpenBreak } from "@/lib/shifts/store";
import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";

export const runtime = "nodejs";

/**
 * Resume from a break (spec D6): back to AVAILABLE + close the open break row.
 *
 * Quality-review fix: this must NOT be a second, ungated OFFLINE->live door.
 * The liveness check and the write are one atomic conditional UPDATE: only a
 * row that is currently (fresh) BREAK may flip back to AVAILABLE. A caller
 * whose shift already lapsed/ended (or who is not on break) matches zero
 * rows and gets 409 — not a phantom live AVAILABLE row with no open shift.
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
    .update({ status: "AVAILABLE", last_seen_at: nowIso })
    .eq("id", actor.userId)
    .eq("status", "BREAK")
    .gte("last_seen_at", staleCutoffIso)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not resume" }, { status: 500 });

  // Finding #1 (defense-in-depth): close any open break for this shift
  // REGARDLESS of whether the status flip matched a row. The primary fix (the
  // hoisted BREAK guard in the heartbeat) prevents a beat from clobbering
  // BREAK -> ON_CALL in the first place, but if the status was already
  // overwritten by some other path, the conditional UPDATE above matches zero
  // rows while the shift_breaks row stays open — and it would then leak to
  // end-of-shift with a bogus duration. closeOpenBreak is idempotent (a no-op
  // when nothing is open), so closing here can only ever help. It runs before
  // the 409 so the "not currently on break" path still cleans up a stray break.
  await closeOpenBreak(admin, actor.userId, nowIso);

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Not currently on break" }, { status: 409 });
  }
  return new NextResponse(null, { status: 204 });
}
