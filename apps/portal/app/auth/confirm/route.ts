import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

// Confirms Supabase **email links** (invite, password recovery, signup, magic
// link). Supabase returns the session for these links in the URL *fragment* by
// default, which a server route cannot read — so the email templates point here
// with a `token_hash`, and we exchange it for a session via `verifyOtp`.
//
// CRITICAL: the session cookies are written onto the SAME redirect response we
// return. A freshly constructed `NextResponse` does NOT inherit cookies set via
// `next/headers`, so the previous `/auth/callback` (which used the shared
// next/headers client + a new NextResponse) never persisted the session —
// invited users landed on /sign-in without a session, never reached
// /onboarding, never set a password, and could never sign in. This pattern
// (request -> response cookie pairing) is what fixes it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only allow same-origin relative paths to prevent an open redirect.
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";

  if (tokenHash && type) {
    const response = NextResponse.redirect(new URL(next, origin));

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

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return response;
    }
  }

  return NextResponse.redirect(new URL("/sign-in", origin));
}
