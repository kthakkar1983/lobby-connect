import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { getTwilioApiCredentials } from "@/lib/twilio/config";
import { buildVoiceAccessToken } from "@/lib/twilio/token";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;

export async function GET(): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, twilio_identity")
    .eq("id", user.id)
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
