import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { closeOpenShiftForUser, capOverlongShifts } from "@/lib/shifts/store";
import { SHIFT_ABANDON_AFTER_MS } from "@lc/shared";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  // Fail closed: the cron must present the secret. An unset secret is a
  // misconfiguration, not an invitation to run unauthenticated.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cut at the ABANDON horizon (SHIFT_ABANDON_AFTER_MS = 12h), NOT the 90s
  // reachability staleness. Duty + video push are RAW-STATUS: an agent works
  // heads-down in RustDesk with the portal tab throttled/frozen, so a stale
  // heartbeat is her NORMAL working state (see lib/shifts/lifecycle canDoWork +
  // lib/push/targets). Sweeping her OFFLINE at 90s would end a live shift AND
  // silence her video push. Read-time reachability (effectivePresence / audio
  // dial / dashboards) already owns the short horizon; this sweep only cleans up
  // an agent who is provably gone (stale past the 12h session cap). The cron
  // CADENCE is the promptness lever — never shorten this cutoff (task_71d65b0a).
  const cutoff = new Date(Date.now() - SHIFT_ABANDON_AFTER_MS).toISOString();
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

  // Second responsibility (SHIFT-length cap, not staleness): force-close any open
  // shift that has run past MAX_SHIFT_MS even if its heartbeat is fresh — the
  // free-tier stand-in for Supabase's deferred 12h session cap, so a forgotten
  // shift on an awake, still-beating machine can't inflate clocked hours
  // unbounded. Runs AFTER the abandon sweep so a shift that is both stale AND
  // over-cap closes at its accurate last_seen_at (above), not the ceiling.
  await capOverlongShifts(admin, Date.now());

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_mark_stale_offline")),
  );

  return NextResponse.json({ ok: true });
}
