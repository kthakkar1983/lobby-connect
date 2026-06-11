import "server-only";
import { NextResponse } from "next/server";
import type { Role } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type { Role };
export interface ApiActor {
  userId: string;
  operatorId: string;
  role: Role;
}

/**
 * Resolve the authenticated API actor: session user -> profile -> role gate.
 * Returns the actor, or a NextResponse (401/403) the caller returns directly.
 * Uses the service-role client for the profile read (matches existing routes).
 * Rejects deactivated users (active === false) with 403 before the role check
 * (A1/D1 — closes the gap where a still-valid JWT bypassed the deactivation).
 */
export async function requireApiActor(
  opts: { allow: Role[] },
): Promise<ApiActor | NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id, role, active")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  // Strict `=== false` (not `!me.active`): `active` is a NOT NULL boolean, so this
  // is exact in prod, and an absent/undefined value (e.g. a partial test row) must
  // not be treated as deactivated. Do not "normalize" this to `!me.active`.
  if (me.active === false) {
    return NextResponse.json({ error: "Account deactivated" }, { status: 403 });
  }

  if (!opts.allow.includes(me.role)) {
    return NextResponse.json({ error: "Forbidden for this role" }, { status: 403 });
  }

  return {
    userId: me.id,
    operatorId: me.operator_id,
    role: me.role,
  };
}

/**
 * Fetch a call scoped to the actor's operator. `columns` is the select list
 * (operator_id is always included for the scope check). Returns the row, or a
 * 404 NextResponse.
 */
export async function fetchOperatorCall<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  actor: ApiActor,
  callId: string,
  columns: string,
): Promise<T | NextResponse> {
  const admin = createAdminClient();
  const hasOperatorId = columns.split(/[\s,]+/).includes("operator_id");
  const select = hasOperatorId ? columns : `${columns}, operator_id`;
  // Dynamic select string: cast the result to loosen the generated-type constraint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: call } = (await (admin as any)
    .from("calls")
    .select(select)
    .eq("id", callId)
    .maybeSingle()) as { data: Record<string, unknown> | null };
  if (!call || (call as Record<string, unknown>).operator_id !== actor.operatorId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  return call as T;
}
