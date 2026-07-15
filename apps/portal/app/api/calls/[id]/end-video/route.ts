import { NextResponse, after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor, fetchOperatorCall } from "@/lib/auth/api-actor";
import { finalizeCallPayload, resetPresenceAfterCall } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
import { sendCallPush } from "@/lib/push/send";
import type { CallState } from "@lc/shared";

export const runtime = "nodejs";

/**
 * Agent-side video-call finalizer. Finalization is normally kiosk-owned
 * (`/api/kiosk/call-ended`), but if the kiosk dies mid-call it never fires and
 * the row leaks. The agent's LiveKit client sees the guest disconnect (kiosk
 * gone) and calls this to close the row in real time. Idempotent: each branch's
 * update is conditional on the call still being in the expected state, so
 * whichever side finalizes first wins and the other no-ops (no double-finalize,
 * no clobbered duration).
 *
 * Also covers the outbound path: an agent-initiated call still RINGING (never
 * answered by the kiosk) finalizes to NO_ANSWER here when the agent cancels or
 * its ring times out. Either way, once this returns the calling agent is done
 * with the call, so presence is unconditionally reset ON_CALL -> AVAILABLE
 * (task_71d65b0a — no path used to reset it, leaving agents stuck "not
 * accepting" after both inbound and outbound video calls).
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

  const admin = createAdminClient();

  if (call.state === "IN_PROGRESS") {
    const endedAt = new Date();

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
  } else if (call.state === "RINGING") {
    // Outbound agent cancel / 30s ring timeout: the kiosk never answered, so
    // this never connected -> NO_ANSWER with no duration. Conditional on
    // still-RINGING so an agent-vs-kiosk-answer race is safe (a concurrent
    // answer flips the row to IN_PROGRESS first and this no-ops).
    const endedAt = new Date();

    await admin
      .from("calls")
      .update(finalizeCallPayload("NO_ANSWER", null, endedAt))
      .eq("id", id)
      .eq("state", "RINGING");

    // Clear the banner on any other tab. No push here (unlike the IN_PROGRESS
    // branch): a call that never connected was not pushed to begin with.
    after(() => {
      void broadcastCallsChanged(actor.operatorId);
    });
  }

  // Unconditional (task_71d65b0a): the agent calling this route is done with the
  // call either way, including the already-finalized no-op case (the other side
  // won the finalize race). Internally guarded on status='ON_CALL', so this is a
  // harmless no-op if presence was already reset (e.g. by the reaper, or by the
  // race winner).
  await resetPresenceAfterCall(admin, actor.userId);

  return NextResponse.json({ ok: true });
}
