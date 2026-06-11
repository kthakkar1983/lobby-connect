import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { getAgoraCredentials } from "@/lib/agora/config";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import type { AgoraTokenResult } from "@lc/shared";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;
const LIVE_STATES = new Set(["RINGING", "IN_PROGRESS"]);

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") ?? "";
  const uidStr = searchParams.get("uid") ?? "";
  const uid = Number(uidStr);
  if (!channel || !uidStr || Number.isNaN(uid)) {
    return NextResponse.json({ error: "Missing channel or uid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, operator_id, state, agora_channel_name")
    .eq("agora_channel_name", channel)
    .maybeSingle();

  if (!call || !LIVE_STATES.has(call.state)) {
    return NextResponse.json({ error: "No live call for channel" }, { status: 404 });
  }

  // Auth branch 1: kiosk config token.
  const kioskToken = request.headers.get("x-kiosk-token");
  if (kioskToken) {
    const verified = verifyKioskToken(kioskToken, getKioskConfigSecret());
    if (!verified) {
      return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
    }
    if (verified.propertyId !== call.property_id) {
      return NextResponse.json({ error: "Channel not in property" }, { status: 403 });
    }
  } else {
    // Auth branch 2: agent/admin session in the same operator.
    // Owners are read-only (07a spec): a publisher token would let them join a
    // live guest video call. Reject the owner role on the session branch.
    const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
    if (actorOrResponse instanceof NextResponse) return actorOrResponse;
    const actor = actorOrResponse;
    if (actor.operatorId !== call.operator_id) {
      return NextResponse.json({ error: "Channel not in operator" }, { status: 403 });
    }
  }

  const { appId, appCertificate } = getAgoraCredentials();
  const token = buildRtcPublisherToken({
    appId,
    appCertificate,
    channelName: channel,
    uid,
    expireSeconds: TOKEN_TTL_SECONDS,
  });

  const payload: AgoraTokenResult = { appId, channelName: channel, uid, token };
  return NextResponse.json(payload);
}
