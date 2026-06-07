import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { STALE_AFTER_MS } from "@/lib/voice/presence";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  // Fail closed: the cron must present the secret. An unset secret is a
  // misconfiguration, not an invitation to run unauthenticated.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .lt("last_seen_at", cutoff)
    .neq("status", "OFFLINE");

  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  for (const op of operators ?? []) {
    await recordHeartbeat(op.id, "cron_mark_stale_offline");
  }

  return NextResponse.json({ ok: true });
}
