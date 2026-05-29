-- supabase/seed.sql
-- LOCAL DEV ONLY. Never run against a remote Supabase project.
-- The password 'localdev123' is intentionally weak; do not personalize this file.
-- Idempotent: safe to re-run via `supabase db reset`.

begin;

-- 1. Operator -----------------------------------------------------------------
insert into operators (id, name, slug)
values ('00000000-0000-0000-0000-0000000000a0', 'Lobby Connect', 'lobby-connect')
on conflict (id) do nothing;

-- 2. Admin auth user ----------------------------------------------------------
-- Inserts directly into auth.users (the GoTrue schema). For local dev only.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'admin@lobbyconnect.local',
  crypt('localdev123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  false,
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- 3. Admin profile ------------------------------------------------------------
insert into profiles (
  id, operator_id, role, full_name, email, status, active
)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a0',
  'ADMIN',
  'Local Admin',
  'admin@lobbyconnect.local',
  'OFFLINE',
  true
)
on conflict (id) do nothing;

-- 3b. Owner + agent auth users (LOCAL DEV ONLY) -------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'alex.agent@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', ''),
  ('00000000-0000-0000-0000-0000000000b4',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bailey.agent@lobbyconnect.local', crypt('localdev123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   now(), now(), false, '', '', '', '')
on conflict (id) do nothing;

-- 3c. Owner + agent profiles --------------------------------------------------
insert into profiles (id, operator_id, role, full_name, email, status, active)
values
  ('00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000a0', 'OWNER', 'Olivia Owner',
   'owner@lobbyconnect.local', 'OFFLINE', true),
  ('00000000-0000-0000-0000-0000000000b3',
   '00000000-0000-0000-0000-0000000000a0', 'AGENT', 'Alex Agent',
   'alex.agent@lobbyconnect.local', 'OFFLINE', true),
  ('00000000-0000-0000-0000-0000000000b4',
   '00000000-0000-0000-0000-0000000000a0', 'AGENT', 'Bailey Agent',
   'bailey.agent@lobbyconnect.local', 'OFFLINE', true)
on conflict (id) do nothing;

-- 4. Sample property ----------------------------------------------------------
insert into properties (
  id, operator_id, name, owner_user_id, timezone, routing_did
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000a0',
  'The Sample Hotel',
  '00000000-0000-0000-0000-0000000000b2',
  'America/New_York',
  '+15555550100'
)
on conflict (id) do nothing;

-- 5. Default operator settings ------------------------------------------------
insert into operator_settings (operator_id, key, value)
values
  ('00000000-0000-0000-0000-0000000000a0', 'default_max_ring_seconds', '120')
on conflict (operator_id, key) do nothing;

commit;
