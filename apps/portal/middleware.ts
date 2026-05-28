// Runs on every portal page request (matcher below). Two jobs:
//   1. Refresh the Supabase auth cookie so server-rendered pages see a fresh session.
//   2. Redirect unauthenticated users to /sign-in.
//
// API routes are excluded — they authenticate themselves (Twilio HMAC, kiosk
// config token, service-role-only invites, etc.). The /sign-in page itself is
// excluded so unauthenticated users can reach it.

import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signInUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Match every path EXCEPT:
    //   - _next/static (build assets)
    //   - _next/image (image optimization)
    //   - favicon.ico
    //   - api/* (API routes do their own auth)
    //   - sign-in (the sign-in page itself)
    //   - auth/* (sign-out POST + password-reset/callback routes)
    "/((?!_next/static|_next/image|favicon.ico|api/|sign-in|auth/).*)",
  ],
};
