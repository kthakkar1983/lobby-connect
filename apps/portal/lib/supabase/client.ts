// Browser-side Supabase client. Use ONLY inside Client Components ('use client').
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
