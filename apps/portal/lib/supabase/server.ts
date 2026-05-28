// Server-side Supabase client for Server Components, Server Actions, and Route Handlers.
import { createServerClient as createSSRServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export async function createServerClient() {
  const cookieStore = await cookies();
  return createSSRServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session cookie on every request, so this is fine.
          }
        },
      },
    },
  );
}
