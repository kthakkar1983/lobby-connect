-- 0015_kiosk_cta_style.sql — Stage 2 (kiosk repaint).
-- Adds an owner-selectable kiosk Home style. text + CHECK (not a pg enum), per the
-- roles convention. Extends the Plan-7b column guard so an OWNER may write it under
-- RLS (the properties_owner_update row policy already covers the row; the trigger
-- gates which columns). Service-role writes have auth.uid()=NULL -> role NULL, so
-- they skip the guard. Idempotent.

-- 1. Column: warm (default) | accent | classic.
alter table properties
  add column if not exists kiosk_cta_style text not null default 'warm';

alter table properties
  drop constraint if exists properties_kiosk_cta_style_check;
alter table properties
  add constraint properties_kiosk_cta_style_check
  check (kiosk_cta_style in ('warm', 'accent', 'classic'));

-- 2. Extend the owner column whitelist (adds 'kiosk_cta_style' to both arrays).
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
          'kiosk_breakfast_hours','kiosk_apology_message',
          'kiosk_cta_style','updated_at'
        ]::text[])
       is distinct from
       (to_jsonb(new) - array[
          'kiosk_welcome_heading','kiosk_welcome_message',
          'kiosk_checkin_time','kiosk_checkout_time',
          'kiosk_wifi_network','kiosk_wifi_password',
          'kiosk_breakfast_hours','kiosk_apology_message',
          'kiosk_cta_style','updated_at'
        ]::text[])
    then
      raise exception 'owners may only edit guest-facing kiosk fields';
    end if;
  end if;
  return new;
end;
$$;
