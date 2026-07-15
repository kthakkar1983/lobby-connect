import { NextResponse, after } from "next/server";

import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { stampKioskLiveness } from "@/lib/kiosk/stamp-liveness";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Best-effort, non-blocking liveness stamp — runs after the response via
  // after() (waitUntil-backed) so it never delays the 204, and a failure here
  // must never fail the heartbeat itself.
  after(() => {
    void stampKioskLiveness(admin, verified.propertyId).catch(() => {});
  });

  return new NextResponse(null, { status: 204 });
}
