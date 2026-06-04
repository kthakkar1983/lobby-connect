import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";
import { logSignOut } from "@/lib/auth/audit";

// Signs the user out. The cleared session cookies MUST be written onto the same
// response we return — a freshly constructed `NextResponse` does not inherit
// cookies set via `next/headers`, so the prior implementation cleared cookies
// that never reached the browser and the user stayed signed in. We build the
// redirect response first and pair the Supabase client's cookie writes to it.
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/sign-in", request.url), {
    status: 303,
  });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logSignOut(user.id);
  }

  await supabase.auth.signOut();

  return response;
}
