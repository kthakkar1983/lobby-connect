import "server-only";
import type { Json } from "@lc/shared";
import { createAdminClient } from "@/lib/supabase/admin";

// Push-signal writer for the /status registry. Service-role upsert keyed on
// (operator_id, signal). Best-effort: a failure here must never break the
// caller's primary work (a Twilio webhook response, a cron sweep), so it
// swallows errors after logging.
export async function recordHeartbeat(
  operatorId: string,
  signal: string,
  details?: Json,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const admin = createAdminClient();
    await admin.from("health_signals").upsert(
      {
        operator_id: operatorId,
        signal,
        last_ok_at: now,
        details: details ?? null,
        updated_at: now,
      },
      { onConflict: "operator_id,signal" },
    );
  } catch (err) {
    console.error("[heartbeat] failed for", signal, err);
  }
}
