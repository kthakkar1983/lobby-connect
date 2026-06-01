import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  const { data: rows } = await admin
    .from("calls")
    .select("id, property_id, agora_channel_name, ring_started_at")
    .eq("operator_id", me.operator_id)
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .order("ring_started_at", { ascending: true });

  const calls = rows ?? [];
  const propertyIds = [...new Set(calls.map((c) => c.property_id as string))];

  let nameById = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, name")
      .in("id", propertyIds);
    nameById = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  }

  return NextResponse.json({
    calls: calls.map((c) => ({
      id: c.id,
      channelName: c.agora_channel_name,
      propertyId: c.property_id,
      propertyName: nameById.get(c.property_id as string) ?? "Property",
      ringStartedAt: c.ring_started_at,
    })),
  });
}
