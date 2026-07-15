-- 0022_calls_direction.sql
-- Distinguish agent-initiated OUTBOUND video calls from guest-initiated INBOUND.
-- Additive + defaulted -> blue-green safe (the frozen Vercel/Agora standby ignores it).
alter table public.calls
  add column direction text not null default 'INBOUND'
    check (direction in ('INBOUND', 'OUTBOUND'));
