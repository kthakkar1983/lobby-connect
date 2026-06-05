-- 0012_admin_provisioning.sql — Plan 9 (email-free admin provisioning).
-- 1. must_change_password flag: set true on admin create/reset, cleared on
--    onboarding. default false so existing + seed users are never force-onboarded.
-- 2. profiles self-update column guard. profiles_update_self (0002) is row-level
--    only, so a non-admin could PATCH their own role/active/etc. This guard (same
--    pattern as 0010's enforce_owner_* triggers) restricts a non-admin self-update
--    to full_name only — closing a privilege-escalation hole AND tamper-proofing
--    the new flag. Service-role/admin writes have auth.uid()=NULL (or role ADMIN)
--    and skip the guard, so onboarding + admin actions still work. Idempotent.

alter table profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function enforce_profile_self_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard only a genuine non-admin self-update. updated_at is excluded because
  -- profiles_set_updated_at (a BEFORE UPDATE trigger) stamps it on every update.
  -- NOTE: status/last_seen_at are intentionally NOT whitelisted — every presence
  -- write (api/presence, answer routes, mark-stale-offline cron) uses the
  -- service-role client (auth.uid() = NULL -> guard skipped), so keep it that way.
  -- The explicit `auth.uid() is not null` makes the service-role bypass obvious
  -- rather than relying on NULL three-valued logic.
  if auth.uid() is not null
     and auth.uid() = new.id
     and coalesce(current_user_role(), '') <> 'ADMIN'
  then
    if (to_jsonb(old) - array['full_name','updated_at']::text[])
       is distinct from
       (to_jsonb(new) - array['full_name','updated_at']::text[])
    then
      raise exception 'profiles: only full_name is self-editable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_profile_self_columns on profiles;
create trigger trg_enforce_profile_self_columns
  before update on profiles
  for each row execute function enforce_profile_self_columns();
