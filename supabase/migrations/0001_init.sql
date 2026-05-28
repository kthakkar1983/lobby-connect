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
