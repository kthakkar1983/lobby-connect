import { NextResponse } from "next/server";

import { authorizeVideoTokenRequest } from "@/lib/video/token-auth";
import { getLiveKitConfig } from "@/lib/video/provider";
import type { VideoTokenResult } from "@lc/shared";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600; // 3600s join-token TTL; expiry cannot drop a CONNECTED LiveKit call (spec D10)

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") ?? "";
  const uidStr = searchParams.get("uid") ?? "";
  const uid = Number(uidStr);
  if (!channel || !uidStr || Number.isNaN(uid)) {
    return NextResponse.json({ error: "Missing channel or uid" }, { status: 400 });
  }

  const requester = await authorizeVideoTokenRequest(request, channel);
  if (requester instanceof NextResponse) return requester;

  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const { AccessToken } = await import("livekit-server-sdk");
  // Identities are meaningful AND ghost-replacing (spec D9): a reconnecting
  // side with the same identity replaces its zombie participant.
  const identity = requester.kind === "kiosk" ? "kiosk" : `agent-${requester.userId}`;
  const at = new AccessToken(apiKey, apiSecret, { identity, ttl: TOKEN_TTL_SECONDS });
  at.addGrant({ roomJoin: true, room: channel, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  const payload: VideoTokenResult = { provider: "livekit", url, channelName: channel, token };
  return NextResponse.json(payload);
}
