// Service-role Supabase client. Bypasses RLS. Use ONLY inside server-only
// code paths: Twilio webhooks, audit log writes, admin-invite routes.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export function createAdminClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
