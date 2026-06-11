import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
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
    .in("state", ["RINGING", "IN_PROGRESS"])
    .limit(1)
    .maybeSingle();
  if (existingActive) {
    return NextResponse.json(
      { error: "A call is already active for this property" },
      { status: 409 },
    );
  }

  const channelName = `call_${randomUUID().replace(/-/g, "")}`;

  const { data: inserted } = await admin
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

  if (!inserted) {
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }

  const payload: CallStartResult = { callId: inserted.id, channelName };
  return NextResponse.json(payload);
}
