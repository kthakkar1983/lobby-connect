import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { REAP_RINGING_AFTER_MS } from "@/lib/calls/reaper";

export const runtime = "nodejs";

export async function GET(_request: Request): Promise<NextResponse> {
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
    .select("id, operator_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }
  // Owners are read-only (07a spec) — they never answer calls, so never poll.
  if (me.role === "OWNER") {
    return NextResponse.json({ error: "Owners cannot answer calls" }, { status: 403 });
  }

  // Time-bound the RINGING window: a crashed kiosk leaks a RINGING row that the
  // daily reaper only closes much later, so without this bound a dead call rings
  // the agent's softphone for hours. The ring window is 120s; anything older than
  // the reaper's RINGING cutoff is a phantom and must not surface.
  const ringingSince = new Date(Date.now() - REAP_RINGING_AFTER_MS).toISOString();
  const { data: rows } = await admin
    .from("calls")
    .select("id, property_id, agora_channel_name, ring_started_at")
    .eq("operator_id", me.operator_id)
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .gte("ring_started_at", ringingSince)
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
