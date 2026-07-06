import { NextResponse, after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { finalizeCallPayload } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
import { sendCallPush } from "@/lib/push/send";
import type { CallState } from "@lc/shared";

export const runtime = "nodejs";

/**
 * Agent-side video-call finalizer. Finalization is normally kiosk-owned
 * (`/api/kiosk/call-ended`), but if the kiosk dies mid-call it never fires and
 * the row leaks. The agent's LiveKit client sees the guest disconnect (kiosk
 * gone) and calls this to close the row in real time. Idempotent: the
 * update is conditional on still-IN_PROGRESS, so whichever side finalizes first
 * wins and the other no-ops (no double-finalize, no clobbered duration).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const call = await fetchOperatorCall<{
    id: string;
    state: CallState;
    operator_id: string;
    answered_at: string | null;
    property_id: string;
  }>(actor, id, "id, state, answered_at, property_id");
  if (call instanceof NextResponse) return call;

  if (call.state === "IN_PROGRESS") {
    const endedAt = new Date();
    const admin = createAdminClient();

    // Conditional on still-IN_PROGRESS so the kiosk-vs-agent finalize race is safe.
    await admin
      .from("calls")
      .update(finalizeCallPayload("COMPLETED", call.answered_at, endedAt))
      .eq("id", id)
      .eq("state", "IN_PROGRESS");

    // Clear the banner on any other tab still showing this call. after()
    // (waitUntil-backed) guarantees the broadcast fires before the function freezes.
    after(() => {
      void broadcastCallsChanged(actor.operatorId);
      void sendCallPush(admin, {
        type: "call-cleared",
        callId: id,
        channel: "VIDEO",
        propertyId: call.property_id,
        propertyName: "",
      });
    });
  }

  return NextResponse.json({ ok: true });
}
