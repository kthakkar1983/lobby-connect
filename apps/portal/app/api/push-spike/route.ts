// TEMPORARY — Gate 3.1 spike only (removed once push is productionized).
// Accepts a raw subscription + delay, sleeps, sends one push. The 360s case
// exceeds Vercel limits by design: run the full drill against box staging.
import { NextResponse } from "next/server";
import webpush from "web-push";
import { requireApiActor } from "@/lib/auth/api-actor";
import { getVapidConfig } from "@/lib/push/vapid";

export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
  if (actor instanceof NextResponse) return actor;

  const body = (await request.json().catch(() => ({}))) as {
    subscription?: { endpoint: string; p256dh: string; auth: string };
    delaySeconds?: number;
  };
  if (!body.subscription?.endpoint) {
    return NextResponse.json({ error: "Missing subscription" }, { status: 400 });
  }
  // Clamp deliberately exceeds this route's maxDuration=60: the 360s drill runs
  // on box staging (long-lived container); on Vercel the 6m button times out by design.
  const delay = Math.min(Math.max(body.delaySeconds ?? 15, 0), 600);
  const scheduledFor = Date.now() + delay * 1000;

  const vapid = getVapidConfig();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  await new Promise((r) => setTimeout(r, delay * 1000));
  try {
    await webpush.sendNotification(
      {
        endpoint: body.subscription.endpoint,
        keys: { p256dh: body.subscription.p256dh, auth: body.subscription.auth },
      },
      JSON.stringify({
        type: "incoming-call",
        callId: `spike-${scheduledFor}`,
        channel: "VIDEO",
        propertyName: "Push spike",
        scheduledFor,
      }),
      { TTL: 120 },
    );
    return NextResponse.json({ ok: true, scheduledFor });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 502 },
    );
  }
}
