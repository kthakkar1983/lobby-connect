-- 0002_rls.sql
-- Row-level security policies for Lobby Connect v1.
-- Spec: docs/specs/2026-05-27-v1-architecture-design.md (§6.2)
-- Plan: docs/plans/2026-05-27-02-database-rls.md
--
-- All policies authorize the `authenticated` role. Service role bypasses RLS.
-- Idempotent via `drop policy if exists ... ; create policy ...`.

-- =============================================================================
-- 1. ENABLE RLS ON ALL TABLES
-- =============================================================================

alter table operators                 enable row level security;
alter table profiles                  enable row level security;
alter table properties                enable row level security;
alter table property_assignments      enable row level security;
alter table admin_call_availability   enable row level security;
alter table calls                     enable row level security;
alter table audit_logs                enable row level security;
alter table operator_settings         enable row level security;

-- =============================================================================
-- 2. operators
--    SELECT: any authenticated user in own operator
--    INSERT/UPDATE/DELETE: service role only (no policy = default-deny)
-- =============================================================================

drop policy if exists "operators_select_own" on operators;
create policy "operators_select_own" on operators
  for select to authenticated
  using (id = current_user_operator_id());

-- =============================================================================
-- 3. profiles
--    SELECT: same-operator (everyone in op sees everyone else's profile)
--    UPDATE (self): user can update their own row (field-level enforcement in app)
--    UPDATE (admin): admin can update any profile in own operator
--    INSERT/DELETE: service role only (admin-invite flow uses service role)
-- =============================================================================

drop policy if exists "profiles_select_same_operator" on profiles;
create policy "profiles_select_same_operator" on profiles
  for select to authenticated
  using (operator_id = current_user_operator_id());

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');