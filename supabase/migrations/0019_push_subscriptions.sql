-- 0019_push_subscriptions.sql
-- Phase 3 (spec §3.7): Web Push subscriptions, one row per browser endpoint.
-- Inserts/updates go through the session-authed route (service role); RLS
-- gives users read/delete on their own rows only.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operator_id uuid not null references public.operators(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user on public.push_subscriptions(user_id);
create index push_subscriptions_operator on public.push_subscriptions(operator_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE policies: writes are service-role only (route-validated).
