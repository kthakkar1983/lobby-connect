import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/health/heartbeat";
import { STALE_AFTER_MS } from "@/lib/voice/presence";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
