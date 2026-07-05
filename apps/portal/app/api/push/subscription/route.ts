import { NextResponse } from "next/server";

import { requireApiActor } from "@/lib/auth/api-actor";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    p256dh?: string;
    auth?: string;
  };
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: actor.userId,
      operator_id: actor.operatorId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ error: "Could not save subscription" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("user_id", actor.userId);
  return new NextResponse(null, { status: 204 });
}
