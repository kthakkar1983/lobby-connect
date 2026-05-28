-- 0001_init.sql
-- Database schema for Lobby Connect v1.
-- Spec: docs/specs/2026-05-27-v1-architecture-design.md (§5)
-- Plan: docs/plans/2026-05-27-02-database-rls.md
--
-- Idempotent: safe to re-apply via `supabase db reset` or manual replay.

-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 2. HELPER FUNCTIONS
-- =============================================================================

-- Trigger function: sets updated_at = now() on row update.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- RLS helper: operator_id of the currently-authenticated user.
-- security definer + pinned search_path avoids recursing into RLS on profiles.
create or replace function current_user_operator_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select operator_id from profiles where id = auth.uid()
$$;

-- RLS helper: role of the currently-authenticated user.
create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- =============================================================================
-- 3. TABLES
-- =============================================================================

-- 3.1 operators ---------------------------------------------------------------
create table if not exists operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- 3.2 profiles ----------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  operator_id uuid not null references operators(id),
  role text not null check (role in ('AGENT', 'ADMIN', 'OWNER')),
  full_name text not null,
  email text not null,
  twilio_identity text unique,
  status text not null default 'OFFLINE'
    check (status in ('AVAILABLE', 'ON_CALL', 'OFFLINE')),
  active boolean not null default true,
  mfa_secret text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_operator on profiles(operator_id);
create index if not exists profiles_role on profiles(operator_id, role);
create unique index if not exists profiles_twilio on profiles(twilio_identity)
  where twilio_identity is not null;

-- 3.3 properties --------------------------------------------------------------
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  name text not null,
  owner_user_id uuid references profiles(id),
  timezone text not null,
  routing_did text,
  property_phone_number text,
  after_hours_support_phone text,
  playbook_pdf_url text,
  playbook_version int default 1,
  logo_url text,
  kiosk_welcome_message text default 'How can we help?',
  kiosk_apology_message text default 'We''re sorry, no one is available right now. Please try again or call us directly.',
  geocoded_lat numeric,
  geocoded_long numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_operator on properties(operator_id);
create index if not exists properties_owner on properties(owner_user_id);
create unique index if not exists properties_routing on properties(routing_did)
  where routing_did is not null;

-- 3.4 property_assignments ----------------------------------------------------
create table if not exists property_assignments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id) on delete cascade,
  primary_agent_id uuid not null references profiles(id),
  backup_agent_id uuid references profiles(id),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists assignments_property
  on property_assignments(property_id, effective_from, effective_until);
create index if not exists assignments_agent
  on property_assignments(primary_agent_id);

-- 3.5 admin_call_availability -------------------------------------------------
create table if not exists admin_call_availability (
  profile_id uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  operator_id uuid not null references operators(id),
  accepting_calls boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (profile_id, property_id)
);

create index if not exists aca_property_accepting
  on admin_call_availability(property_id)
  where accepting_calls = true;

-- 3.6 calls -------------------------------------------------------------------
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id),
  channel text not null check (channel in ('AUDIO', 'VIDEO')),
  state text not null
    check (state in ('RINGING', 'IN_PROGRESS', 'COMPLETED', 'NO_ANSWER', 'FAILED')),
  twilio_call_sid text unique,
  agora_channel_name text,
  caller_number text,
  handled_by_user_id uuid references profiles(id),
  room_number text,
  ring_started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  recording_url text,
  recording_sid text,
  flagged_for_review boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists calls_property_recent
  on calls(property_id, created_at desc);
create index if not exists calls_operator_recent
  on calls(operator_id, created_at desc);
create index if not exists calls_agent_recent
  on calls(handled_by_user_id, created_at desc);
create index if not exists calls_state_active
  on calls(state)
  where state in ('RINGING', 'IN_PROGRESS');

-- 3.7 audit_logs --------------------------------------------------------------
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  actor_user_id uuid references profiles(id),
  actor_type text not null check (actor_type in ('USER', 'SYSTEM')),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_operator_recent
  on audit_logs(operator_id, created_at desc);
create index if not exists audit_entity
  on audit_logs(entity_type, entity_id);

-- 3.8 operator_settings -------------------------------------------------------
create table if not exists operator_settings (
  operator_id uuid not null references operators(id),
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (operator_id, key)
);

-- =============================================================================
-- 4. UPDATED_AT TRIGGERS
-- =============================================================================

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists properties_set_updated_at on properties;
create trigger properties_set_updated_at
  before update on properties
  for each row execute function set_updated_at();

drop trigger if exists admin_call_availability_set_updated_at on admin_call_availability;
create trigger admin_call_availability_set_updated_at
  before update on admin_call_availability
  for each row execute function set_updated_at();

drop trigger if exists operator_settings_set_updated_at on operator_settings;
create trigger operator_settings_set_updated_at
  before update on operator_settings
  for each row execute function set_updated_at();

-- =============================================================================
-- 5. STORAGE BUCKETS
-- =============================================================================
-- Bucket policies (read/write rules) live in 0002_rls.sql.

insert into storage.buckets (id, name, public)
values
  ('playbooks', 'playbooks', false),
  ('logos',     'logos',     true),
  ('audio',     'audio',     true)
on conflict (id) do nothing;
