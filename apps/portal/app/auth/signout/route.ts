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
//
// The redirect Location is RELATIVE ("/sign-in"), not built from `request.url`.
// Behind the box's Traefik proxy a route handler's `request.url` resolves to the
// container's internal bind address (http://0.0.0.0:3000), so an absolute
// redirect built from it 303s the browser to an unreachable 0.0.0.0:3000/sign-in.
// A relative Location is resolved by the browser against the page's real origin
// (app.lobby-connect.com), independent of how the server sees its own URL.
// (Sign-out is always a same-origin form POST, so this is unambiguous. The
// middleware's own /sign-in redirect uses request.url safely — middleware sees
// the forwarded host, unlike a route handler.)
export async function POST(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/sign-in" },
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
