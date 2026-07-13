-- 0021_shift_tracking.sql — admin shift + time tracking (spec 2026-07-12).
-- Presence-derived shift records + a first-class BREAK status. Service-role for
-- all automated writes (0012 column guard blocks user-scoped status writes);
-- admins read/edit operator-scoped. Idempotent where practical.

-- 1. Widen the presence status CHECK to add BREAK (on duty, not working).
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('AVAILABLE', 'ON_CALL', 'AWAY', 'BREAK', 'OFFLINE'));

-- 2. shifts: one row per on-duty period. ended_at IS NULL = open/live.
-- user_id/edited_by reference profiles(id) (matches calls/property_assignments/
-- incidents) with the DEFAULT (RESTRICT) action — NO cascade — so a user with
-- shift history can't be hard-deleted, preserving the app's hard-delete guard.
create table if not exists shifts (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references operators(id),
  user_id       uuid not null references profiles(id),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  ended_reason  text check (ended_reason in ('manual','lapsed','capped')),
  edited_by     uuid references profiles(id) on delete set null,
  edited_at     timestamptz,
  created_at    timestamptz not null default now()
);

-- One open shift per user (temporal-row invariant, mirrors property_assignments).
create unique index if not exists shifts_one_open
  on shifts (user_id) where ended_at is null;
create index if not exists shifts_operator_started
  on shifts (operator_id, started_at desc);
create index if not exists shifts_user_started
  on shifts (user_id, started_at desc);

-- 3. shift_breaks: intervals within a shift. ended_at IS NULL = break in progress.
create table if not exists shift_breaks (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references shifts(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists shift_breaks_one_open
  on shift_breaks (shift_id) where ended_at is null;
-- General FK-covering index for cascade deletes + any future full-history read
-- (the partial index above only covers in-progress breaks). NOTE: the v1
-- timesheet does not yet read shift_breaks (break time is a spec-deferred column);
-- this index anticipates that read and the ON DELETE CASCADE from shifts.
create index if not exists shift_breaks_shift
  on shift_breaks (shift_id);

-- 4. RLS. Automated open/close/break are service-role (auth.uid() IS NULL ->
--    current_user_role() IS NULL, so no policy grants them; service role
--    bypasses RLS). Admins read + edit operator-scoped; agents get NO client
--    access (the header timer comes from GET /api/presence, not a client read).
alter table shifts enable row level security;
alter table shift_breaks enable row level security;

drop policy if exists "shifts_admin_select" on shifts;
create policy "shifts_admin_select" on shifts
  for select to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_update" on shifts;
create policy "shifts_admin_update" on shifts
  for update to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_insert" on shifts;
create policy "shifts_admin_insert" on shifts
  for insert to authenticated
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

drop policy if exists "shifts_admin_delete" on shifts;
create policy "shifts_admin_delete" on shifts
  for delete to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- shift_breaks: admin read only (edited via the parent shift). No client writes.
drop policy if exists "shift_breaks_admin_select" on shift_breaks;
create policy "shift_breaks_admin_select" on shift_breaks
  for select to authenticated
  using (
    current_user_role() = 'ADMIN'
    and exists (
      select 1 from shifts s
      where s.id = shift_breaks.shift_id
        and s.operator_id = current_user_operator_id()
    )
  );
