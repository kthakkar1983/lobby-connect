import "server-only";
import { cache } from "react";
import type { Role } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";

export type SessionProfile = {
  id: string;
  role: Role;
  operator_id: string;
  active: boolean;
  must_change_password: boolean;
  full_name: string;
  email: string;
};

// One getUser + one profiles read per RSC render, memoized so a layout and its
// page (both gate via requireRole) don't each hit Auth + Postgres. cache() is
// React-render-scoped: it does NOT span the middleware runtime, so middleware
// keeps its own getUser (3 hops -> 2). Returns null when unauthenticated.
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, operator_id, active, must_change_password, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  return (data as SessionProfile | null) ?? null;
});
