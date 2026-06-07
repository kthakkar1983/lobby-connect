// Service-role Supabase client. Bypasses RLS. Use ONLY inside server-only
// code paths: Twilio webhooks, audit log writes, admin-invite routes.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";
import { timeoutFetch } from "@/lib/supabase/timeout-fetch";

/**
 * Service-role client. Pass `timeoutMs` on the latency-critical voice path so a
 * hung Supabase request aborts (and lands in the route's apology-TwiML catch)
 * instead of dead air. Omit it for identical default behaviour everywhere else.
 */
export function createAdminClient(opts?: { timeoutMs?: number }) {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(opts?.timeoutMs
        ? { global: { fetch: timeoutFetch(opts.timeoutMs) } }
        : {}),
    },
  );
}
