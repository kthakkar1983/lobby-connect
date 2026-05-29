-- 0004_fix_rls_recursion.sql
-- Fixes an infinite-recursion bug in the RLS policies from 0002_rls.sql.
--
-- Bug: `properties_select` (AGENT branch) referenced `property_assignments`,
-- and `assignments_select` (owner branch) referenced `properties`. When
-- PostgreSQL plans a query on either table, expanding one policy pulls in the
-- other table's RLS, which pulls the first back in — a cycle. `calls_select`
-- (owner branch) also references `properties`, joining the same cycle. The
-- result is: `ERROR: infinite recursion detected in policy for relation
-- "properties"`. It was latent until Plan 4b because the seed inserts as the
-- table owner (RLS bypassed) and no app code had yet read `properties` through
-- a user-scoped (RLS-enforced) client.
--
-- Fix: move the cross-table existence checks into SECURITY DEFINER helper
-- functions (same pattern as current_user_operator_id / current_user_role in
-- 0001). A SECURITY DEFINER function owned by the migration role runs with the
-- owner's privileges and does NOT re-enter RLS on the tables it reads, so the
-- policy-evaluation cycle is broken. Authorization semantics are unchanged —
-- the same rows remain visible to the same roles.
--
-- Idempotent: `create or replace function` + `drop policy if exists`.

-- =============================================================================
-- 1. SECURITY DEFINER cross-table helpers
-- =============================================================================

-- True when the current user is the owner of the given property. Used by the
-- owner branches of assignments_select and calls_select. SECURITY DEFINER so
-- reading `properties` here does not re-enter properties RLS.
create or replace function user_owns_property(prop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from properties
    where id = prop_id
      and owner_user_id = auth.uid()
  )
$$;

-- True when the current user is the active primary agent assigned to the given
-- property. Used by the AGENT branch of properties_select. SECURITY DEFINER so
-- reading `property_assignments` here does not re-enter its RLS.
create or replace function user_is_assigned_to_property(prop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from property_assignments pa
    where pa.property_id = prop_id
      and pa.primary_agent_id = auth.uid()
      and (pa.effective_until is null or pa.effective_until > now())
  )
$$;

-- =============================================================================
-- 2. Rewrite the three policies that formed the cycle
--    (identical semantics; inline EXISTS replaced by the helpers above)
-- =============================================================================

drop policy if exists "properties_select" on properties;
create policy "properties_select" on properties
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or (current_user_role() = 'OWNER' and owner_user_id = auth.uid())
      or (
        current_user_role() = 'AGENT'
        and user_is_assigned_to_property(properties.id)
      )
    )
  );

drop policy if exists "assignments_select" on property_assignments;
create policy "assignments_select" on property_assignments
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or primary_agent_id = auth.uid()
      or backup_agent_id = auth.uid()
      or user_owns_property(property_assignments.property_id)
    )
  );

drop policy if exists "calls_select" on calls;
create policy "calls_select" on calls
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or handled_by_user_id = auth.uid()
      or user_owns_property(calls.property_id)
    )
  );
