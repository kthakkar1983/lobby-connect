// Server-side Web Push send. Fire-and-forget from route `after()` blocks —
// never throws into the caller; failures go to Sentry; 404/410 endpoints are
// pruned (expired subscriptions).
import * as Sentry from "@sentry/nextjs";
import webpush from "web-push";
import { PUSH_TTL_SECONDS } from "@lc/shared";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getVapidConfig } from "@/lib/push/vapid";
import { resolveTargetUserIds } from "@/lib/push/targets";

type Admin = ReturnType<typeof createAdminClient>;

export interface CallPushPayload {
  type: "incoming-call" | "call-cleared";
  callId: string;
  channel: "AUDIO" | "VIDEO";
  propertyId: string;
  propertyName: string;
}

export async function sendCallPush(admin: Admin, payload: CallPushPayload): Promise<void> {
  try {
    const userIds = await resolveTargetUserIds(admin, payload.propertyId);
    if (userIds.length === 0) return;

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", userIds);
    if (!subs || subs.length === 0) return;

    const vapid = getVapidConfig();
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    const body = JSON.stringify(payload);

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: PUSH_TTL_SECONDS },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else {
            Sentry.captureMessage(`sendCallPush failed: ${status ?? "unknown"}`, {
              extra: { propertyId: payload.propertyId, status },
            });
          }
        }
      }),
    );
  } catch (err) {
    Sentry.captureException(err);
  }
}
