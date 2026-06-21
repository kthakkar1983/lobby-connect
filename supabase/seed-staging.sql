-- Lobby Connect — STAGING seed (throwaway data; safe to re-run; idempotent).
--
-- Applied to the staging Supabase project (ref cgtvqjxhbojztzumshca) AFTER
-- migrations 0001-0017. Mirrors what was run via the Supabase MCP during the
-- 2026-06-21 staging setup. NOT for production (prod uses supabase/bootstrap-prod.sql).

-- 1. Operator (single tenant, slug matches prod so any slug lookups still resolve).
insert into operators (id, name, slug)
values (gen_random_uuid(), 'Lobby Connect (Staging)', 'lobby-connect')
on conflict (slug) do nothing;

-- 2. Default ring window (matches local/prod).
insert into operator_settings (operator_id, key, value)
values ((select id from operators where slug = 'lobby-connect'), 'default_max_ring_seconds', '120')
on conflict (operator_id, key) do nothing;

-- 3. Sample property (no auth user needed). routing_did is a dummy — staging has
--    no Twilio, so it is never dialed. (properties has no `address` column.)
insert into properties (id, operator_id, name, timezone, routing_did, active)
values (
  '00000000-0000-0000-0000-0000000000c1',
  (select id from operators where slug = 'lobby-connect'),
  'Staging Test Hotel',
  'America/Chicago',
  '+15555550100',
  true
)
on conflict (id) do nothing;

-- NOTE: the staging admin user is created via the GoTrue admin API (POST
-- /auth/v1/admin/users with the service-role key), NOT via SQL — a raw auth.users
-- insert skips auth.identities and breaks sign-in on a hosted project. The matching
-- profile row (ADMIN) is then inserted by hand. See the staging runbook.
