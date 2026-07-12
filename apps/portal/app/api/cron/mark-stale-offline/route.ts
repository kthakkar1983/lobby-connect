import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { closeOpenShiftForUser } from "@/lib/shifts/store";
import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  // Fail closed: the cron must present the secret. An unset secret is a
  // misconfiguration, not an invitation to run unauthenticated.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - PRESENCE_STALE_AFTER_MS).toISOString();
  const admin = createAdminClient();
  // Return the swept rows so we can close each one's open shift at its OWN last
  // heartbeat (spec D9: ended_at = last_seen_at, never "now") — the reliability
  // backstop for shifts whose owner closed the tab / whose session expired.
  const { data: swept } = await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .lt("last_seen_at", cutoff)
    .neq("status", "OFFLINE")
    .select("id, last_seen_at");

  await Promise.all(
    (swept ?? []).map((p) =>
      closeOpenShiftForUser(admin, p.id, p.last_seen_at ?? cutoff, "auto"),
    ),
  );

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_mark_stale_offline")),
  );

  return NextResponse.json({ ok: true });
}
