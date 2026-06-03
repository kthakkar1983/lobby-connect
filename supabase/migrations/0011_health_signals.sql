-- 0011_health_signals.sql
-- Generic health-signal registry for the /status page. Push signals (Twilio
-- webhook, cron jobs) self-report last_ok_at; pull signals (Supabase, Sentry)
-- are probed live and are NOT stored here. operator_id keeps it multi-tenant.

create table if not exists health_signals (
  operator_id uuid not null references operators(id),
  signal      text not null,
  last_ok_at  timestamptz,
  details     jsonb,
  updated_at  timestamptz not null default now(),
  primary key (operator_id, signal)
);

alter table health_signals enable row level security;

-- Admins of the operator may read their own operator's signals.
-- Writes are service-role only (webhooks + cron), which bypasses RLS, so there
-- is no insert/update policy here by design.
create policy health_signals_admin_select on health_signals
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'ADMIN'
  );
