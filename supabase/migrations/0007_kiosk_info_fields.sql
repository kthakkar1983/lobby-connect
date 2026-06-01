-- 0007: kiosk home-screen owner info-card fields (Plan 6a).
-- All nullable, no defaults: a blank field is simply not rendered on the kiosk.
alter table properties
  add column if not exists kiosk_welcome_heading text,
  add column if not exists kiosk_checkin_time    text,
  add column if not exists kiosk_checkout_time   text,
  add column if not exists kiosk_wifi_network    text,
  add column if not exists kiosk_wifi_password   text,
  add column if not exists kiosk_breakfast_hours text;
