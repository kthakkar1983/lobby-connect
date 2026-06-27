import { NextResponse } from "next/server";
import { createSpeechmaticsJWT } from "@speechmatics/auth";

import { requireApiActor } from "@/lib/auth/api-actor";

export const runtime = "nodejs";

// The temp key only needs to live long enough to OPEN the WS; the session then
// persists. 120s gives comfortable headroom over connect latency.
const TOKEN_TTL_SECONDS = 120;

export async function GET(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;

  const apiKey = process.env.SPEECHMATICS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Captions unavailable" }, { status: 503 });
  }

  try {
    const token = await createSpeechmaticsJWT({ type: "rt", apiKey, ttl: TOKEN_TTL_SECONDS });
    return NextResponse.json({ token, expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000 });
  } catch {
    return NextResponse.json({ error: "Captions unavailable" }, { status: 502 });
  }
}
