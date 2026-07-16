-- 0023_kiosks_liveness.sql
-- Per-property kiosk liveness. A dedicated table keeps the 3-30s write cadence
-- off the read-heavy properties row. One kiosk per property today (config token is
-- property-scoped); forward-compatible with multiple. Writes are service-role only
-- (kiosk-token routes use the admin client); select is operator-scoped.
create table if not exists public.kiosks (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references operators(id),
  property_id   uuid not null references properties(id),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists kiosks_one_per_property
  on public.kiosks(property_id);

alter table public.kiosks enable row level security;

-- Operator-scoped read (mirrors current_user_operator_id() usage in other policies).
drop policy if exists "kiosks_select_operator" on public.kiosks;
create policy "kiosks_select_operator" on public.kiosks
  for select to authenticated
  using (operator_id = current_user_operator_id());

-- No insert/update/delete policies: all writes go through the service-role admin client.

-- FK-index hygiene (0013 precedent): covers the operator_id RLS SELECT filter.
create index if not exists kiosks_operator_id_idx
  on public.kiosks (operator_id);
