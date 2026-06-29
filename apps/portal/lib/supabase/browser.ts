"use client";
// Authenticated browser Supabase client, used for the Realtime subscription in
// IncomingVideoBanner. Reads the @supabase/ssr cookie session so the websocket
// carries the agent JWT (required for private-channel RLS).
//
// Deliberately does NOT import `@/lib/env`: that module validates
// SUPABASE_SERVICE_ROLE_KEY at load and would throw in the browser bundle. The
// NEXT_PUBLIC_* vars are inlined by Next at build, so read process.env directly.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@lc/shared";

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
