import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { ACTIVE_CALL_STATES } from "@/lib/voice/call-state";
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
import type { CallStartResult } from "@lc/shared";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, active")
    .eq("id", verified.propertyId)
    .maybeSingle();

  if (!property || !property.active) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  // One kiosk = one live call. Reject if the property already has an active
  // VIDEO call so a leaked token (or a reload storm) can't mint unlimited
  // RINGING rows and ring-spam the agent's softphone.
  const { data: existingActive } = await admin
    .from("calls")
    .select("id")
    .eq("property_id", property.id)
    .eq("channel", "VIDEO")
    .in("state", ACTIVE_CALL_STATES)
    .limit(1)
    .maybeSingle();
  if (existingActive) {
    return NextResponse.json(
      { error: "A call is already active for this property" },
      { status: 409 },
    );
  }

  const channelName = `call_${randomUUID().replace(/-/g, "")}`;

  const { data: inserted, error: insertError } = await admin
    .from("calls")
    .insert({
      operator_id: property.operator_id,
      property_id: property.id,
      channel: "VIDEO",
      state: "RINGING",
      agora_channel_name: channelName,
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 = unique_violation: the partial index (calls_one_active_video_per_property)
    // caught a concurrent active VIDEO call that slipped past the check-then-insert
    // fast-path above (e.g. double-tap / reload storm). Map to 409 — same body as the
    // fast-path check so the kiosk can handle both uniformly.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "A call is already active for this property" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }
  if (!inserted) {
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }

  // Nudge agent tabs to refetch — the ring starts via Realtime push, not the poll.
  // after() (waitUntil-backed) guarantees the broadcast fires before the function
  // freezes; a bare `void` detached fetch is not guaranteed to run. Non-blocking.
  after(() => broadcastCallsChanged(property.operator_id));

  const payload: CallStartResult = { callId: inserted.id, channelName };
  return NextResponse.json(payload);
}
