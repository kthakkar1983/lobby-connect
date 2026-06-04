-- ============================================================================
-- Lobby Connect — PRODUCTION bootstrap
-- ----------------------------------------------------------------------------
-- Run this in the Supabase dashboard SQL editor (or psql) AFTER:
--   1. migrations 0001–0011 are applied to the prod project, and
--   2. you have created the first admin user in the dashboard
--      (Authentication → Users → Add user → real email + password).
--
-- Do NOT run supabase/seed.sql in production — that file inserts fake local
-- users straight into auth.users and is local-dev only.
--
-- EDIT the three <PLACEHOLDER> values in section 2, then run the whole script.
-- It is idempotent: safe to re-run.
-- ============================================================================

begin;

-- 1) Operator (single tenant for v1) -----------------------------------------
insert into operators (id, name, slug)
values (gen_random_uuid(), 'Lobby Connect', 'lobby-connect')
on conflict (slug) do nothing;

-- 2) First admin profile -----------------------------------------------------
-- Replace all three placeholders:
--   <ADMIN_AUTH_USER_ID> — the UUID shown in Authentication → Users for the
--                          admin you just created (this MUST match an existing
--                          auth.users row, or the FK insert fails).
--   <ADMIN_FULL_NAME>    — e.g. 'Kumar Thakkar'
--   <ADMIN_EMAIL>        — the same email you used in the dashboard
insert into profiles (id, operator_id, role, full_name, email, status, active)
values (
  '<ADMIN_AUTH_USER_ID>',
  (select id from operators where slug = 'lobby-connect'),
  'ADMIN',
  '<ADMIN_FULL_NAME>',
  '<ADMIN_EMAIL>',
  'OFFLINE',
  true
)
on conflict (id) do update
  set role        = 'ADMIN',
      active      = true,
      operator_id = excluded.operator_id;

-- 3) Twilio identity ---------------------------------------------------------
-- Call-takers (ADMIN/AGENT) need a deterministic identity so an inbound call
-- can dial them via the softphone. Mirrors lib/voice/identity.ts.
update profiles
   set twilio_identity = 'lc_' || replace(id::text, '-', '')
 where role in ('ADMIN', 'AGENT')
   and twilio_identity is null;

-- 4) Default operator setting (matches local) --------------------------------
insert into operator_settings (operator_id, key, value)
values (
  (select id from operators where slug = 'lobby-connect'),
  'default_max_ring_seconds',
  '120'
)
on conflict (operator_id, key) do nothing;

commit;

-- After this: sign in to the portal as the admin, then create the property,
-- assign a primary agent, and invite the rest of the team through the app's
-- own invite flow (Admin → Users). See docs/setup/2026-06-03-launch-checklist.md.
