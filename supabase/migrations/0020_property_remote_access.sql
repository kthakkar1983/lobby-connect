-- 0020_property_remote_access.sql
-- Phase 3 (spec §3.5/D14): RustDesk unattended-access credentials per property.
-- RLS is enabled with deliberately NO policies, plus explicit REVOKEs: no client
-- role can read or write anything — every access goes through service-role code
-- paths (admin server actions + the audited credential API). D14: the password is
-- plaintext at rest (Supabase disk encryption; app-layer envelope encryption is a
-- v2 seam riding per-connect rotation).

create table public.property_remote_access (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  operator_id uuid not null references public.operators(id),
  peer_id text not null,
  unattended_password text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.property_remote_access enable row level security;

-- Belt-and-suspenders (0014 hardening spirit): even a future accidental policy
-- add must not expose this table to client roles.
revoke all on table public.property_remote_access from anon, authenticated;

-- House updated_at trigger (0001 defines set_updated_at()).
drop trigger if exists property_remote_access_set_updated_at on property_remote_access;
create trigger property_remote_access_set_updated_at
  before update on property_remote_access
  for each row execute function set_updated_at();

-- FK-index hygiene (0013 precedent).
create index if not exists property_remote_access_operator_id_idx
  on public.property_remote_access (operator_id);
