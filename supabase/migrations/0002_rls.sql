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

-- =============================================================================
-- 4. properties
--    SELECT: admin (all in op) OR owner (own properties) OR agent (assigned)
--    INSERT/UPDATE/DELETE: admin only
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
        and exists (
          select 1 from property_assignments pa
          where pa.property_id = properties.id
            and pa.primary_agent_id = auth.uid()
            and (pa.effective_until is null or pa.effective_until > now())
        )
      )
    )
  );

drop policy if exists "properties_admin_write" on properties;
create policy "properties_admin_write" on properties
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 5. property_assignments
--    SELECT: admin OR primary agent OR backup agent OR property owner
--    INSERT/UPDATE/DELETE: admin only
-- =============================================================================

drop policy if exists "assignments_select" on property_assignments;
create policy "assignments_select" on property_assignments
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or primary_agent_id = auth.uid()
      or backup_agent_id = auth.uid()
      or exists (
        select 1 from properties p
        where p.id = property_assignments.property_id
          and p.owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists "assignments_admin_write" on property_assignments;
create policy "assignments_admin_write" on property_assignments
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 6. admin_call_availability
--    SELECT/WRITE: admin can read/write only their own rows.
--    Routing webhook (service role) reads everyone's rows — no auth policy needed.
-- =============================================================================

drop policy if exists "aca_admin_select_own" on admin_call_availability;
create policy "aca_admin_select_own" on admin_call_availability
  for select to authenticated
  using (profile_id = auth.uid() and current_user_role() = 'ADMIN');

drop policy if exists "aca_admin_write_own" on admin_call_availability;
create policy "aca_admin_write_own" on admin_call_availability
  for all to authenticated
  using (profile_id = auth.uid() and current_user_role() = 'ADMIN')
  with check (profile_id = auth.uid() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 7. calls
--    SELECT: admin (all in op) OR agent (own handled) OR owner (own properties)
--    INSERT/UPDATE/DELETE: service role only (Twilio webhooks)
-- =============================================================================

drop policy if exists "calls_select" on calls;
create policy "calls_select" on calls
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or handled_by_user_id = auth.uid()
      or exists (
        select 1 from properties p
        where p.id = calls.property_id
          and p.owner_user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- 8. audit_logs
--    SELECT: admin only
--    INSERT/UPDATE/DELETE: service role only
-- =============================================================================

drop policy if exists "audit_admin_select" on audit_logs;
create policy "audit_admin_select" on audit_logs
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'ADMIN'
  );

-- =============================================================================
-- 9. operator_settings
--    SELECT: any authenticated user in op
--    INSERT/UPDATE/DELETE: admin only
-- =============================================================================

drop policy if exists "operator_settings_select" on operator_settings;
create policy "operator_settings_select" on operator_settings
  for select to authenticated
  using (operator_id = current_user_operator_id());

drop policy if exists "operator_settings_admin_write" on operator_settings;
create policy "operator_settings_admin_write" on operator_settings
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 10. STORAGE POLICIES (storage.objects)
--     logos / audio: bucket public=true handles unauthenticated reads.
--                    Authenticated writes restricted to admins.
--     playbooks:     fully private. Admin all-access; agents access via
--                    signed URLs minted by portal API (service role).
-- =============================================================================

drop policy if exists "storage_admin_write_logos" on storage.objects;
create policy "storage_admin_write_logos" on storage.objects
  for all to authenticated
  using (bucket_id = 'logos' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'logos' and current_user_role() = 'ADMIN');

drop policy if exists "storage_admin_write_audio" on storage.objects;
create policy "storage_admin_write_audio" on storage.objects
  for all to authenticated
  using (bucket_id = 'audio' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'audio' and current_user_role() = 'ADMIN');

drop policy if exists "storage_admin_all_playbooks" on storage.objects;
create policy "storage_admin_all_playbooks" on storage.objects
  for all to authenticated
  using (bucket_id = 'playbooks' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'playbooks' and current_user_role() = 'ADMIN');