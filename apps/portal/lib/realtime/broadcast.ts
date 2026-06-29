import "server-only";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";

/**
 * Fire a content-free "calls-changed" nudge to the operator's private Realtime
 * channel so agent tabs refetch the incoming-video list. Stateless: one HTTP
 * POST to Supabase's broadcast endpoint (no held socket from the function).
 *
 * Best-effort by contract: a non-2xx or a thrown error is swallowed + reported,
 * NEVER re-thrown, so a Realtime hiccup can't fail or delay the call path. The
 * 60s safety-net poll in IncomingVideoBanner is the delivery guarantee.
 */
export async function broadcastCallsChanged(operatorId: string): Promise<void> {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          { topic: operatorCallsChannelTopic(operatorId), event: CALLS_CHANGED_EVENT, payload: {} },
        ],
      }),
    });
    if (!res.ok) {
      Sentry.captureMessage(`broadcastCallsChanged non-2xx: ${res.status}`);
    }
  } catch (err) {
    Sentry.captureException(err);
  }
}
