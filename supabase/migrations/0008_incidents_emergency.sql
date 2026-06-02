-- 0008: Emergency call (Plan 6c).
-- Adds the conference-name flag on calls + a high-priority incidents table.

-- 1. calls: the emergency conference name. NULL = a normal call. Non-null is the
--    flag the dial-result webhook keys on to route the guest into the conference.
alter table calls
  add column if not exists emergency_conference_name text;

-- 2. incidents: one row per emergency trigger. severity/kind/status are
--    CHECK-constrained text (not enums) so future values need no destructive
--    migration. 6c only ever inserts OPEN / HIGH / EMERGENCY_911 rows.
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id),
  call_id uuid references calls(id),
  triggered_by uuid references profiles(id),
  severity text not null default 'HIGH' check (severity in ('HIGH')),
  kind text not null default 'EMERGENCY_911' check (kind in ('EMERGENCY_911')),
  dispatched_to text not null,
  conference_name text,
  conference_sid text,
  emergency_call_sid text,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists incidents_operator_recent on incidents(operator_id, created_at desc);
create index if not exists incidents_property on incidents(property_id);
create index if not exists incidents_call on incidents(call_id);

-- 3. RLS — operator-scoped reads; writes are service-role only (no authenticated
--    write policy, mirroring audit_logs). Owner branch uses the SECURITY DEFINER
--    helper user_owns_property() to avoid the policy-recursion trap (see 0004).
alter table incidents enable row level security;

drop policy if exists "incidents_select" on incidents;
create policy "incidents_select" on incidents
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or triggered_by = auth.uid()
      or user_owns_property(incidents.property_id)
    )
  );
