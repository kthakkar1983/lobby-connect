-- 5b presence: agents toggle Ready/Away. "Away" = connected but not accepting.
-- Display-only in v1 (routing untouched); enables a future one-line routing gate.
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('AVAILABLE', 'ON_CALL', 'AWAY', 'OFFLINE'));
