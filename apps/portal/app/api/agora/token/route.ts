import { NextResponse } from "next/server";

import { authorizeVideoTokenRequest } from "@/lib/video/token-auth";
import { getAgoraCredentials } from "@/lib/agora/config";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import type { AgoraTokenResult } from "@lc/shared";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;

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
