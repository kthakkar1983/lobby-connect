import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  if (profile.role === "AGENT") redirect("/agent");
  if (profile.role === "ADMIN") redirect("/admin");
  if (profile.role === "OWNER") redirect("/owner");
  redirect("/sign-in");
}
