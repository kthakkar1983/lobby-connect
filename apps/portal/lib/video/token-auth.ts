import "server-only";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { ACTIVE_CALL_STATES } from "@/lib/voice/call-state";

export type VideoTokenRequester = { kind: "kiosk" } | { kind: "session"; userId: string };

/**
 * Shared authorization for the video token routes (/api/agora/token and
 * /api/video/token): resolve the LIVE call by channel, then dual-auth — kiosk
 * config token (property-scoped) OR an AGENT/ADMIN session in the call's
 * operator (OWNER rejected — publisher tokens would let a read-only role join
 * a live guest call). Extracted VERBATIM from /api/agora/token in Phase 4;
 * behavior byte-identical (that route's tests are the guard). The requester
 * identity feeds the LiveKit branch's participant identity (spec D9).
 */
export async function authorizeVideoTokenRequest(
  request: Request,
  channel: string,
): Promise<VideoTokenRequester | NextResponse> {
  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, operator_id, state, agora_channel_name")
    .eq("agora_channel_name", channel)
    .maybeSingle();

  if (!call || !(ACTIVE_CALL_STATES as readonly string[]).includes(call.state)) {
    return NextResponse.json({ error: "No live call for channel" }, { status: 404 });
  }

  const kioskToken = request.headers.get("x-kiosk-token");
  if (kioskToken) {
    const verified = verifyKioskToken(kioskToken, getKioskConfigSecret());
    if (!verified) {
      return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
    }
    if (verified.propertyId !== call.property_id) {
      return NextResponse.json({ error: "Channel not in property" }, { status: 403 });
    }
    return { kind: "kiosk" };
  }

  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  if (actorOrResponse.operatorId !== call.operator_id) {
    return NextResponse.json({ error: "Channel not in operator" }, { status: 403 });
  }
  return { kind: "session", userId: actorOrResponse.userId };
}
