import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Agent-side video-call finalizer. Finalization is normally kiosk-owned
 * (`/api/kiosk/call-ended`), but if the kiosk dies mid-call it never fires and
 * the row leaks. The agent's Agora client receives the guest's `user-left`
 * (kiosk gone) and calls this to close the row in real time. Idempotent: the
 * update is conditional on still-IN_PROGRESS, so whichever side finalizes first
 * wins and the other no-ops (no double-finalize, no clobbered duration).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }
  // Owners are read-only (07a spec) — they never participate in a live call.
  if (me.role === "OWNER") {
    return NextResponse.json({ error: "Owners cannot join live calls" }, { status: 403 });
  }

  const { data: call } = await admin
    .from("calls")
    .select("id, state, operator_id, answered_at")
    .eq("id", id)
    .maybeSingle();
  if (!call || call.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  if (call.state === "IN_PROGRESS") {
    const endedAt = new Date();
    const durationSeconds = call.answered_at
      ? Math.max(
          0,
          Math.round((endedAt.getTime() - new Date(call.answered_at as string).getTime()) / 1000),
        )
      : null;

    // Conditional on still-IN_PROGRESS so the kiosk-vs-agent finalize race is safe.
    await admin
      .from("calls")
      .update({
        state: "COMPLETED",
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq("id", id)
      .eq("state", "IN_PROGRESS");
  }

  return NextResponse.json({ ok: true });
}
