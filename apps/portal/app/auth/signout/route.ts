import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { logSignOut } from "@/lib/auth/audit";

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logSignOut(user.id);
  }

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
}
