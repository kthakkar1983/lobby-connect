-- 0013: Security + performance hardening from the 2026-06-06 readiness audit.
--
-- All items here are defense-in-depth / forward-scale only: at pilot scale
-- (1 operator, ~26 calls) none changes observable behaviour. Scoped to the
-- cheap, low-risk advisor items; the broader auth_rls_initplan policy rewrite,
-- the multiple-permissive-policy consolidation, and unused-index drops are
-- intentionally deferred (they require rewriting every policy and only matter at
-- much larger scale — tracked in the v2 backlog).

-- 1. Covering indexes for unindexed foreign keys (perf advisor 0001_unindexed_foreign_keys).
create index if not exists admin_call_availability_operator
  on admin_call_availability(operator_id);
create index if not exists audit_logs_actor
  on audit_logs(actor_user_id);
create index if not exists incidents_triggered_by_idx
  on incidents(triggered_by);
create index if not exists property_assignments_backup_agent
  on property_assignments(backup_agent_id);
create index if not exists property_assignments_operator
  on property_assignments(operator_id);

-- 2. Pin the search_path on set_updated_at (security advisor: function_search_path_mutable).
--    The 7 RLS helper functions already pin search_path=public; this trigger fn did not.
alter function public.set_updated_at() set search_path = public, pg_temp;

-- 3. Revoke EXECUTE from `anon` on the SECURITY DEFINER RLS helpers + column-guard
--    triggers (security advisor: these were callable by anon via /rest/v1/rpc/*).
--    They are only ever evaluated inside RLS policies / BEFORE-UPDATE triggers,
--    all of which target the `authenticated` role; no policy targets `anon`
--    (verified), and trigger functions don't require caller EXECUTE. So anon
--    never needs them. The `authenticated` grant is intentionally kept — RLS
--    evaluates the SELECT/owner helpers as the querying user.
revoke execute on function public.current_user_operator_id() from anon;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.user_owns_property(uuid) from anon;
revoke execute on function public.user_is_assigned_to_property(uuid) from anon;
revoke execute on function public.enforce_owner_incident_columns() from anon;
revoke execute on function public.enforce_owner_property_columns() from anon;
revoke execute on function public.enforce_profile_self_columns() from anon;
