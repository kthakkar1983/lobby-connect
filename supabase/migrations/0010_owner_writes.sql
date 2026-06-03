-- 0010_owner_writes.sql — Plan 7b (owner self-service writes).
-- Adds: incidents.resolution_note; owner UPDATE policies on properties + incidents;
-- BEFORE UPDATE column-guard triggers. RLS is row-level only, so the triggers are
-- what restrict an OWNER (even via direct PostgREST) to the kiosk fields / resolve.
-- Service-role writes have auth.uid() = NULL -> current_user_role() = NULL, never
-- 'OWNER', so they skip both guards. Idempotent.

-- 1. Owner's optional resolution note. Kept separate from the system `notes` the
--    emergency route writes at creation, so resolving never clobbers diagnostics.
alter table incidents
  add column if not exists resolution_note text;

-- 2. properties: owner UPDATE row policy (column scope enforced by trigger below).
drop policy if exists "properties_owner_update" on properties;
create policy "properties_owner_update" on properties
  for update to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and owner_user_id = auth.uid()
  )
  with check (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and owner_user_id = auth.uid()
  );

-- 3. incidents: owner UPDATE row policy. user_owns_property() is the 0004
--    SECURITY DEFINER helper (avoids the policy-recursion trap).
drop policy if exists "incidents_owner_update" on incidents;
create policy "incidents_owner_update" on incidents
  for update to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and user_owns_property(incidents.property_id)
  )
  with check (
    operator_id = current_user_operator_id()
    and current_user_role() = 'OWNER'
    and user_owns_property(incidents.property_id)
  );

-- 4. properties column guard: an OWNER may change ONLY the 8 kiosk_* fields.
--    Diff every OTHER column via jsonb subtraction, so any future column is
--    protected by default until added to this whitelist.
create or replace function enforce_owner_property_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() = 'OWNER' then
    if (to_jsonb(old) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message'
        ]::text[])
       is distinct from
       (to_jsonb(new) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message'
        ]::text[])
    then
      raise exception 'owners may only edit guest-facing kiosk fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_owner_property_columns on properties;
create trigger trg_enforce_owner_property_columns
  before update on properties
  for each row execute function enforce_owner_property_columns();

-- 5. incidents column guard: an OWNER may change ONLY status/resolved_at/
--    resolution_note, and NEVER an already-RESOLVED incident (resolve is final).
create or replace function enforce_owner_incident_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() = 'OWNER' then
    if old.status = 'RESOLVED' then
      raise exception 'resolved incidents are final';
    end if;
    if (to_jsonb(old) - array['status','resolved_at','resolution_note']::text[])
       is distinct from
       (to_jsonb(new) - array['status','resolved_at','resolution_note']::text[])
    then
      raise exception 'owners may only resolve an incident';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_owner_incident_columns on incidents;
create trigger trg_enforce_owner_incident_columns
  before update on incidents
  for each row execute function enforce_owner_incident_columns();
