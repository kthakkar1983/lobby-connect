import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { canDoWork } from "@/lib/shifts/lifecycle";

type Admin = ReturnType<typeof createAdminClient>;

/** Server-side hard gate: returns null if the user may work, else a 403 the
 *  caller returns. Fail-CLOSED (a work action must not run if duty is unconfirmable). */
export async function requireOnDuty(admin: Admin, userId: string): Promise<NextResponse | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("status, last_seen_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: "Go on duty to start your shift" }, { status: 403 });
  }
  if (!canDoWork(data.status, data.last_seen_at, Date.now())) {
    return NextResponse.json({ error: "Go on duty to start your shift" }, { status: 403 });
  }
  return null;
}
