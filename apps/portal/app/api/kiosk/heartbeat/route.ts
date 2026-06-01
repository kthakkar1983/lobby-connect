import { NextResponse } from "next/server";

import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  if (!verifyKioskToken(token, getKioskConfigSecret())) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }
  // v1: liveness is a no-op beyond auth. A kiosks.last_seen_at write slots in here later.
  return new NextResponse(null, { status: 204 });
}
