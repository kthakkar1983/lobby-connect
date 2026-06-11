import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";
import { getTwilioApiCredentials } from "@/lib/twilio/config";
import { buildVoiceAccessToken } from "@/lib/twilio/token";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;

export async function GET(): Promise<NextResponse> {
  const actorOrResponse = await requireApiActor({ allow: ["AGENT", "ADMIN", "OWNER"] });
  if (actorOrResponse instanceof NextResponse) return actorOrResponse;
  const actor = actorOrResponse;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, twilio_identity")
    .eq("id", actor.userId)
    .maybeSingle();

  if (!profile || !profile.twilio_identity) {
    return NextResponse.json(
      { error: "Not a call-taker" },
      { status: 403 },
    );
  }

  const creds = getTwilioApiCredentials();
  const token = buildVoiceAccessToken({
    ...creds,
    identity: profile.twilio_identity,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });

  return NextResponse.json({ token, identity: profile.twilio_identity });
}
