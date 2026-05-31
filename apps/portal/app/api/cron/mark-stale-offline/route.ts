import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
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

  return NextResponse.json({ ok: true });
}
