# Database & RLS Implementation Plan (Plan 2 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the locked v1 schema and RLS matrix into two committed migration files, an idempotent local seed, and a hand-written TypeScript `Database` type. By the end of this plan, the SQL exists and the type-check passes — verifying the migrations actually apply against a local Postgres is a follow-up step gated on Docker install.

**Architecture:** Two ordered migration files under `supabase/migrations/`: `0001_init.sql` creates extensions, helper functions, tables (in FK order), indexes, `updated_at` triggers, and storage buckets; `0002_rls.sql` enables row-level security and attaches policies for every table plus storage. A `supabase/seed.sql` populates a single operator + admin auth user + sample property for local dev. `packages/shared/src/supabase-types.ts` is hand-written but matches the shape `supabase gen types` will eventually produce, so swapping to generated types later is a file replacement, not a refactor.

**Tech stack:**
- PostgreSQL 15 (Supabase-managed)
- Supabase auth schema + `storage.buckets` / `storage.objects`
- `pgcrypto` extension for UUIDs and password hashing
- TypeScript 5 (consumes the hand-written types)

---

## Plan roadmap (you are here: Plan 2)

| # | Plan | Outputs |
|---|---|---|
| 1 | Foundation | Empty shell that boots, lints, tests, type-checks |
| **2** | **Database & RLS** ← *this plan* | `0001_init.sql`, `0002_rls.sql`, `seed.sql`, hand-written TS types |
| 3 | Auth & role routing | Supabase SSR client, middleware gate, sign-in/onboarding, role-grouped layouts |
| 4 | Admin CRUD | Properties, profiles, assignments, `admin_call_availability`, audit log writes |
| 5 | Voice path & agent dashboard | Twilio webhooks, parallel-dial TwiML, softphone, call history |
| 6 | Owner portal | Mobile-first properties + recordings + kiosk message editing |
| 7 | Kiosk | K-01→K-04→K-08, Agora client, kiosk→portal API, agora token route |
| 8 | Observability | Sentry, `/status` page, `/audit` page, stale-OFFLINE cron |

---

## Pre-flight (one-time, do once before Task 1)

```bash
git status                          # expect clean working tree on main
git describe --tags --abbrev=0      # expect plan-01-foundation-complete
pnpm --version                      # expect 9.x
pnpm typecheck                      # expect pass — Foundation baseline
```

If any of these fails, fix before starting. **Docker is NOT required for this plan.** Local migration apply is a follow-up step after Docker Desktop is installed.

---

## Reference docs (open in a second tab)

- `docs/specs/2026-05-27-v1-architecture-design.md` — §5 schema, §6 RLS matrix
- `docs/specs/2026-05-27-database-rls-design.md` — Plan 2 design (mechanical decisions)

---

## File map (what exists after this plan)

```
Lobby Connect/
├── supabase/
│   ├── config.toml                          ← unchanged from Plan 1
│   ├── migrations/
│   │   ├── 0001_init.sql                    ← Tasks 1–4 (new)
│   │   └── 0002_rls.sql                     ← Tasks 5–8 (new)
│   ├── seed.sql                             ← Task 9 (new)
│   └── functions/                           ← unchanged, empty
│
└── packages/shared/src/
    ├── index.ts                             ← Task 11 (modified — add re-export)
    ├── version.ts                           ← unchanged
    └── supabase-types.ts                    ← Task 10 (new)
```

No app code is touched in this plan.

---

## Task 1: `0001_init.sql` — extensions + helper functions

**Files:**
- Create: `supabase/migrations/0001_init.sql`

This task writes the file header, enables `pgcrypto`, and defines the three helper functions used everywhere downstream: `set_updated_at` (trigger function for auto-updating the `updated_at` column) and the two `SECURITY DEFINER` RLS helpers `current_user_operator_id` and `current_user_role`.

The two RLS helpers must be `STABLE SECURITY DEFINER` with a pinned `search_path = public` — without `security definer` they would themselves be filtered by the RLS policies they're used inside, causing infinite recursion.

- [ ] **Step 1: Create the file with header + extensions + helpers.**

File `supabase/migrations/0001_init.sql`:
```sql
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
```

- [ ] **Step 2: Sanity check the file was written.**

Run: `wc -l supabase/migrations/0001_init.sql`
Expected: ~45 lines.

Run: `grep -c "create or replace function" supabase/migrations/0001_init.sql`
Expected: `3`.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): 0001_init — extensions + RLS helper functions"
```

---

## Task 2: `0001_init.sql` — all 8 tables + indexes

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)

This task adds all eight tables in FK-safe order: `operators` → `profiles` → `properties` → `property_assignments` + `admin_call_availability` → `calls` → `audit_logs` → `operator_settings`. Each table's indexes are co-located with its `create table` block.

Notes:
- `profiles.id` references `auth.users(id)` — the `auth` schema is provided by Supabase and always exists in a Supabase Postgres instance.
- All enum-like columns are `text` + `check (col in (...))`, never Postgres `ENUM` types (locked decision §2.7).
- All `operator_id` references are nullable in TypeScript-land only because the seed/admin code populates them; in SQL they are `not null`.
- Partial unique indexes (`profiles_twilio`, `properties_routing`) allow many rows to have `NULL` while still constraining non-null values to be unique.

- [ ] **Step 1: Append all 8 tables + indexes to the migration.**

Append to `supabase/migrations/0001_init.sql`:
```sql

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
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "create table if not exists" supabase/migrations/0001_init.sql`
Expected: `8`.

Run: `grep -cE "create (unique )?index if not exists" supabase/migrations/0001_init.sql`
Expected: `15` (13 plain + 2 unique-partial: `profiles_twilio`, `properties_routing`).

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): 0001_init — 8 tables + indexes in FK order"
```

---

## Task 3: `0001_init.sql` — updated_at triggers

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)

Four tables have `updated_at` columns that need auto-update on row modification: `profiles`, `properties`, `admin_call_availability`, `operator_settings`. (`calls.ended_at`, `calls.answered_at` are set explicitly by webhooks. `operators` and `audit_logs` are append-only.)

Each trigger uses `drop trigger if exists ... ; create trigger ...` for idempotency.

- [ ] **Step 1: Append the trigger block.**

Append to `supabase/migrations/0001_init.sql`:
```sql

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
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "create trigger" supabase/migrations/0001_init.sql`
Expected: `4`.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): 0001_init — updated_at triggers on 4 mutable tables"
```

---

## Task 4: `0001_init.sql` — storage buckets

**Files:**
- Modify: `supabase/migrations/0001_init.sql` (append)

Supabase storage buckets are rows in `storage.buckets`. Three buckets per architecture spec §5.9: `playbooks` (private), `logos` (public-read), `audio` (public-read). Insert with `on conflict (id) do nothing` for idempotency.

The actual access policies for objects inside these buckets land in `0002_rls.sql` Task 8.

- [ ] **Step 1: Append the storage block.**

Append to `supabase/migrations/0001_init.sql`:
```sql

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
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "into storage.buckets" supabase/migrations/0001_init.sql`
Expected: `1`.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): 0001_init — storage buckets (playbooks, logos, audio)"
```

`0001_init.sql` is now complete. Moving to `0002_rls.sql`.

---

## Task 5: `0002_rls.sql` — enable RLS + operators/profiles policies

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

`alter table ... enable row level security` is required on every table. RLS denies-by-default once enabled, so even before we add policies, the `authenticated` role cannot read or write any of these tables. Service role bypasses RLS entirely.

Policy patterns used throughout `0002_rls.sql` (these match the design spec §6):
- **Pattern A — same-operator SELECT**: scope by `operator_id = current_user_operator_id()`.
- **Pattern B — admin-only mutation**: add `current_user_role() = 'ADMIN'` predicate.
- **Pattern E — service-role-only writes**: no policy needed; default-deny.

For `profiles`, two parallel UPDATE policies (self + admin) combine via OR: PostgreSQL applies the union of all matching policies for the same command.

- [ ] **Step 1: Create the file with header + enable-RLS block + operators/profiles policies.**

File `supabase/migrations/0002_rls.sql`:
```sql
-- 0002_rls.sql
-- Row-level security policies for Lobby Connect v1.
-- Spec: docs/specs/2026-05-27-v1-architecture-design.md (§6.2)
-- Plan: docs/plans/2026-05-27-02-database-rls.md
--
-- All policies authorize the `authenticated` role. Service role bypasses RLS.
-- Idempotent via `drop policy if exists ... ; create policy ...`.

-- =============================================================================
-- 1. ENABLE RLS ON ALL TABLES
-- =============================================================================

alter table operators                 enable row level security;
alter table profiles                  enable row level security;
alter table properties                enable row level security;
alter table property_assignments      enable row level security;
alter table admin_call_availability   enable row level security;
alter table calls                     enable row level security;
alter table audit_logs                enable row level security;
alter table operator_settings         enable row level security;

-- =============================================================================
-- 2. operators
--    SELECT: any authenticated user in own operator
--    INSERT/UPDATE/DELETE: service role only (no policy = default-deny)
-- =============================================================================

drop policy if exists "operators_select_own" on operators;
create policy "operators_select_own" on operators
  for select to authenticated
  using (id = current_user_operator_id());

-- =============================================================================
-- 3. profiles
--    SELECT: same-operator (everyone in op sees everyone else's profile)
--    UPDATE (self): user can update their own row (field-level enforcement in app)
--    UPDATE (admin): admin can update any profile in own operator
--    INSERT/DELETE: service role only (admin-invite flow uses service role)
-- =============================================================================

drop policy if exists "profiles_select_same_operator" on profiles;
create policy "profiles_select_same_operator" on profiles
  for select to authenticated
  using (operator_id = current_user_operator_id());

drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles
  for update to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "enable row level security" supabase/migrations/0002_rls.sql`
Expected: `8`.

Run: `grep -c "create policy" supabase/migrations/0002_rls.sql`
Expected: `4`.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): 0002_rls — enable RLS + operators/profiles policies"
```

---

## Task 6: `0002_rls.sql` — properties + property_assignments policies

**Files:**
- Modify: `supabase/migrations/0002_rls.sql` (append)

`properties` SELECT is the most complex policy in the schema: admins see all in operator, owners see only properties where `owner_user_id = auth.uid()`, agents see properties they have an active assignment to.

`property_assignments` SELECT mirrors `properties` visibility: admins, the assigned agent (primary or backup), or the property owner can read the assignment row.

Both tables use Pattern B (admin-only) for writes.

- [ ] **Step 1: Append properties + property_assignments policies.**

Append to `supabase/migrations/0002_rls.sql`:
```sql

-- =============================================================================
-- 4. properties
--    SELECT: admin (all in op) OR owner (own properties) OR agent (assigned)
--    INSERT/UPDATE/DELETE: admin only
-- =============================================================================

drop policy if exists "properties_select" on properties;
create policy "properties_select" on properties
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or (current_user_role() = 'OWNER' and owner_user_id = auth.uid())
      or (
        current_user_role() = 'AGENT'
        and exists (
          select 1 from property_assignments pa
          where pa.property_id = properties.id
            and pa.primary_agent_id = auth.uid()
            and (pa.effective_until is null or pa.effective_until > now())
        )
      )
    )
  );

drop policy if exists "properties_admin_write" on properties;
create policy "properties_admin_write" on properties
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 5. property_assignments
--    SELECT: admin OR primary agent OR backup agent OR property owner
--    INSERT/UPDATE/DELETE: admin only
-- =============================================================================

drop policy if exists "assignments_select" on property_assignments;
create policy "assignments_select" on property_assignments
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or primary_agent_id = auth.uid()
      or backup_agent_id = auth.uid()
      or exists (
        select 1 from properties p
        where p.id = property_assignments.property_id
          and p.owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists "assignments_admin_write" on property_assignments;
create policy "assignments_admin_write" on property_assignments
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "create policy" supabase/migrations/0002_rls.sql`
Expected: `8` (4 from Task 5 + 4 added here).

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): 0002_rls — properties + property_assignments policies"
```

---

## Task 7: `0002_rls.sql` — remaining table policies

**Files:**
- Modify: `supabase/migrations/0002_rls.sql` (append)

Four tables left: `admin_call_availability`, `calls`, `audit_logs`, `operator_settings`.

- `admin_call_availability`: admin reads/writes ONLY their own rows. The routing webhook (service role) bypasses these and reads everyone's.
- `calls`: admin sees all in op; agent sees calls they handled; owner sees calls at their properties. Writes are service-role only (Twilio webhooks).
- `audit_logs`: admin-only SELECT. Writes service-role only.
- `operator_settings`: anyone authenticated in op can read; admin writes.

- [ ] **Step 1: Append the four-table policy block.**

Append to `supabase/migrations/0002_rls.sql`:
```sql

-- =============================================================================
-- 6. admin_call_availability
--    SELECT/WRITE: admin can read/write only their own rows.
--    Routing webhook (service role) reads everyone's rows — no auth policy needed.
-- =============================================================================

drop policy if exists "aca_admin_select_own" on admin_call_availability;
create policy "aca_admin_select_own" on admin_call_availability
  for select to authenticated
  using (profile_id = auth.uid() and current_user_role() = 'ADMIN');

drop policy if exists "aca_admin_write_own" on admin_call_availability;
create policy "aca_admin_write_own" on admin_call_availability
  for all to authenticated
  using (profile_id = auth.uid() and current_user_role() = 'ADMIN')
  with check (profile_id = auth.uid() and current_user_role() = 'ADMIN');

-- =============================================================================
-- 7. calls
--    SELECT: admin (all in op) OR agent (own handled) OR owner (own properties)
--    INSERT/UPDATE/DELETE: service role only (Twilio webhooks)
-- =============================================================================

drop policy if exists "calls_select" on calls;
create policy "calls_select" on calls
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or handled_by_user_id = auth.uid()
      or exists (
        select 1 from properties p
        where p.id = calls.property_id
          and p.owner_user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- 8. audit_logs
--    SELECT: admin only
--    INSERT/UPDATE/DELETE: service role only
-- =============================================================================

drop policy if exists "audit_admin_select" on audit_logs;
create policy "audit_admin_select" on audit_logs
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'ADMIN'
  );

-- =============================================================================
-- 9. operator_settings
--    SELECT: any authenticated user in op
--    INSERT/UPDATE/DELETE: admin only
-- =============================================================================

drop policy if exists "operator_settings_select" on operator_settings;
create policy "operator_settings_select" on operator_settings
  for select to authenticated
  using (operator_id = current_user_operator_id());

drop policy if exists "operator_settings_admin_write" on operator_settings;
create policy "operator_settings_admin_write" on operator_settings
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "create policy" supabase/migrations/0002_rls.sql`
Expected: `14` (8 from prior tasks + 6 added here).

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): 0002_rls — admin_call_availability + calls + audit + settings policies"
```

---

## Task 8: `0002_rls.sql` — storage policies

**Files:**
- Modify: `supabase/migrations/0002_rls.sql` (append)

Storage policies live on `storage.objects`. `logos` and `audio` are public-read (handled by the bucket's `public=true` flag at the gateway level); we only need write policies for admins. `playbooks` is fully private — admins read/write directly via the dashboard or admin UI; agents access via signed URLs minted by portal API routes using the service role, so no policy for the `authenticated` role is needed for agent reads.

- [ ] **Step 1: Append the storage policy block.**

Append to `supabase/migrations/0002_rls.sql`:
```sql

-- =============================================================================
-- 10. STORAGE POLICIES (storage.objects)
--     logos / audio: bucket public=true handles unauthenticated reads.
--                    Authenticated writes restricted to admins.
--     playbooks:     fully private. Admin all-access; agents access via
--                    signed URLs minted by portal API (service role).
-- =============================================================================

drop policy if exists "storage_admin_write_logos" on storage.objects;
create policy "storage_admin_write_logos" on storage.objects
  for all to authenticated
  using (bucket_id = 'logos' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'logos' and current_user_role() = 'ADMIN');

drop policy if exists "storage_admin_write_audio" on storage.objects;
create policy "storage_admin_write_audio" on storage.objects
  for all to authenticated
  using (bucket_id = 'audio' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'audio' and current_user_role() = 'ADMIN');

drop policy if exists "storage_admin_all_playbooks" on storage.objects;
create policy "storage_admin_all_playbooks" on storage.objects
  for all to authenticated
  using (bucket_id = 'playbooks' and current_user_role() = 'ADMIN')
  with check (bucket_id = 'playbooks' and current_user_role() = 'ADMIN');
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "create policy" supabase/migrations/0002_rls.sql`
Expected: `17` (14 from prior + 3 storage).

Run: `grep -c "bucket_id" supabase/migrations/0002_rls.sql`
Expected: `6` (each of 3 policies references it twice — in `using` and `with check`).

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): 0002_rls — storage policies for logos/audio/playbooks"
```

`0002_rls.sql` is now complete.

---

## Task 9: `supabase/seed.sql` — local dev seed

**Files:**
- Create: `supabase/seed.sql`

Idempotent seed for local development. Creates:
- 1 operator (`Lobby Connect`)
- 1 admin auth user (`admin@lobbyconnect.local` / `localdev123`)
- 1 admin profile linked to that auth user
- 1 sample property owned by the admin
- 1 operator setting

Fixed UUIDs make re-runs safe via `on conflict (id) do nothing`. The auth user insert hits `auth.users` directly using `crypt('localdev123', gen_salt('bf'))` for the password hash (the `pgcrypto` extension was enabled in `0001_init.sql`).

The columns in `auth.users` include several required `text not null` fields (`confirmation_token`, `recovery_token`, etc.) that have empty-string defaults in Supabase's schema; we pass `''` explicitly to be safe across CLI versions.

- [ ] **Step 1: Create the seed file.**

File `supabase/seed.sql`:
```sql
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

-- 4. Sample property ----------------------------------------------------------
insert into properties (
  id, operator_id, name, owner_user_id, timezone, routing_did
)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-0000000000a0',
  'The Sample Hotel',
  '00000000-0000-0000-0000-0000000000b1',
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
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "on conflict" supabase/seed.sql`
Expected: `5` (one per insert).

Run: `grep -c "^begin;\|^commit;" supabase/seed.sql`
Expected: `2`.

- [ ] **Step 3: Commit.**

```bash
git add supabase/seed.sql
git commit -m "feat(db): idempotent local-dev seed (operator + admin + sample property)"
```

---

## Task 10: `packages/shared/src/supabase-types.ts` — hand-written TS types

**Files:**
- Create: `packages/shared/src/supabase-types.ts`

Hand-written `Database` type matching the eventual `supabase gen types typescript` output, so a future swap to generated types is a single-file replacement. String-union types (`Role`, `ProfileStatus`, `CallChannel`, `CallState`, `ActorType`) are exported separately and referenced inside the table `Row`/`Insert`/`Update` definitions — that's what `supabase gen types` does when it sees `text` + `check (col in (...))` constraints with the right Supabase CLI version, and gives the app real type safety on those columns.

`Insert` makes columns optional when the SQL has a default or is nullable; `Update` makes everything optional. Numeric `created_at`/`updated_at` columns surface as ISO strings (Supabase returns them serialized).

- [ ] **Step 1: Create the file.**

File `packages/shared/src/supabase-types.ts`:
```ts
// packages/shared/src/supabase-types.ts
//
// Hand-written types matching the shape of `supabase gen types typescript`.
// When a remote Supabase project is linked, regenerate this file via:
//   pnpm supabase gen types typescript --linked > packages/shared/src/supabase-types.ts
// Until then, keep this file in sync with supabase/migrations/*.sql by hand.

// =============================================================================
// String-union types for CHECK-constrained columns
// =============================================================================

export type Role = "AGENT" | "ADMIN" | "OWNER";
export type ProfileStatus = "AVAILABLE" | "ON_CALL" | "OFFLINE";
export type CallChannel = "AUDIO" | "VIDEO";
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";
export type ActorType = "USER" | "SYSTEM";

// =============================================================================
// Generic JSON helper (mirrors what gen types emits)
// =============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// Database — top-level type, mirrors `supabase gen types` shape
// =============================================================================

export type Database = {
  public: {
    Tables: {
      operators: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          operator_id: string;
          role: Role;
          full_name: string;
          email: string;
          twilio_identity: string | null;
          status: ProfileStatus;
          active: boolean;
          mfa_secret: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          operator_id: string;
          role: Role;
          full_name: string;
          email: string;
          twilio_identity?: string | null;
          status?: ProfileStatus;
          active?: boolean;
          mfa_secret?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          role?: Role;
          full_name?: string;
          email?: string;
          twilio_identity?: string | null;
          status?: ProfileStatus;
          active?: boolean;
          mfa_secret?: string | null;
          last_seen_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      properties: {
        Row: {
          id: string;
          operator_id: string;
          name: string;
          owner_user_id: string | null;
          timezone: string;
          routing_did: string | null;
          property_phone_number: string | null;
          after_hours_support_phone: string | null;
          playbook_pdf_url: string | null;
          playbook_version: number | null;
          logo_url: string | null;
          kiosk_welcome_message: string | null;
          kiosk_apology_message: string | null;
          geocoded_lat: number | null;
          geocoded_long: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          name: string;
          owner_user_id?: string | null;
          timezone: string;
          routing_did?: string | null;
          property_phone_number?: string | null;
          after_hours_support_phone?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          logo_url?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_apology_message?: string | null;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          name?: string;
          owner_user_id?: string | null;
          timezone?: string;
          routing_did?: string | null;
          property_phone_number?: string | null;
          after_hours_support_phone?: string | null;
          playbook_pdf_url?: string | null;
          playbook_version?: number | null;
          logo_url?: string | null;
          kiosk_welcome_message?: string | null;
          kiosk_apology_message?: string | null;
          geocoded_lat?: number | null;
          geocoded_long?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      property_assignments: {
        Row: {
          id: string;
          operator_id: string;
          property_id: string;
          primary_agent_id: string;
          backup_agent_id: string | null;
          effective_from: string;
          effective_until: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          property_id: string;
          primary_agent_id: string;
          backup_agent_id?: string | null;
          effective_from?: string;
          effective_until?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          property_id?: string;
          primary_agent_id?: string;
          backup_agent_id?: string | null;
          effective_from?: string;
          effective_until?: string | null;
          created_at?: string;
        };
      };
      admin_call_availability: {
        Row: {
          profile_id: string;
          property_id: string;
          operator_id: string;
          accepting_calls: boolean;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          property_id: string;
          operator_id: string;
          accepting_calls?: boolean;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          property_id?: string;
          operator_id?: string;
          accepting_calls?: boolean;
          updated_at?: string;
        };
      };
      calls: {
        Row: {
          id: string;
          operator_id: string;
          property_id: string;
          channel: CallChannel;
          state: CallState;
          twilio_call_sid: string | null;
          agora_channel_name: string | null;
          caller_number: string | null;
          handled_by_user_id: string | null;
          room_number: string | null;
          ring_started_at: string;
          answered_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          recording_url: string | null;
          recording_sid: string | null;
          flagged_for_review: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          property_id: string;
          channel: CallChannel;
          state: CallState;
          twilio_call_sid?: string | null;
          agora_channel_name?: string | null;
          caller_number?: string | null;
          handled_by_user_id?: string | null;
          room_number?: string | null;
          ring_started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          recording_url?: string | null;
          recording_sid?: string | null;
          flagged_for_review?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          property_id?: string;
          channel?: CallChannel;
          state?: CallState;
          twilio_call_sid?: string | null;
          agora_channel_name?: string | null;
          caller_number?: string | null;
          handled_by_user_id?: string | null;
          room_number?: string | null;
          ring_started_at?: string;
          answered_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          recording_url?: string | null;
          recording_sid?: string | null;
          flagged_for_review?: boolean;
          notes?: string | null;
          created_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          operator_id: string;
          actor_user_id: string | null;
          actor_type: ActorType;
          action: string;
          entity_type: string;
          entity_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          operator_id: string;
          actor_user_id?: string | null;
          actor_type: ActorType;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          operator_id?: string;
          actor_user_id?: string | null;
          actor_type?: ActorType;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
      };
      operator_settings: {
        Row: {
          operator_id: string;
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          key: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          operator_id?: string;
          key?: string;
          value?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// =============================================================================
// Convenience aliases
// =============================================================================

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// Named row aliases for ergonomic imports across the app
export type Operator = Tables<"operators">;
export type Profile = Tables<"profiles">;
export type Property = Tables<"properties">;
export type PropertyAssignment = Tables<"property_assignments">;
export type AdminCallAvailability = Tables<"admin_call_availability">;
export type Call = Tables<"calls">;
export type AuditLog = Tables<"audit_logs">;
export type OperatorSettings = Tables<"operator_settings">;
```

- [ ] **Step 2: Sanity check.**

Run: `grep -c "^      [a-z_]*: {$" packages/shared/src/supabase-types.ts`
Expected: `8` (one per table block).

Run: `grep -c "^export type" packages/shared/src/supabase-types.ts`
Expected: `18` (5 CHECK-column unions + `Json` + `Database` + 3 generic helpers `Tables`/`TablesInsert`/`TablesUpdate` + 8 named row aliases).

- [ ] **Step 3: Commit.**

```bash
git add packages/shared/src/supabase-types.ts
git commit -m "feat(shared): hand-written Database TS types (matches gen output shape)"
```

---

## Task 11: Re-export from `packages/shared/src/index.ts` + verify typecheck

**Files:**
- Modify: `packages/shared/src/index.ts`

Single-line addition: re-export the new types module so app code can `import { Profile, Database } from "@lobby-connect/shared"` (or whatever the package name is — check `packages/shared/package.json`).

After the edit, `pnpm typecheck` from the repo root must pass cleanly — this is the only verification gate inside Plan 2 (the rest is deferred until Docker is installed).

- [ ] **Step 1: Read the current `index.ts`.**

Run: `cat packages/shared/src/index.ts`
Expected output:
```
export * from "./version";
```

- [ ] **Step 2: Add the supabase-types re-export.**

Edit `packages/shared/src/index.ts` so the final contents are:
```ts
export * from "./version";
export * from "./supabase-types";
```

- [ ] **Step 3: Typecheck at the repo root.**

Run: `pnpm typecheck`
Expected: PASS for every package. No errors mentioning `supabase-types.ts`.

If a `TS2742` "type cannot be named without a reference" error appears in a downstream package, that means the consuming package needs to import `Database` directly; not expected in Plan 2 because no consumer exists yet, but flag it if seen.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): re-export supabase-types from package root"
```

---

## Task 12: Final wrap-up — tag and update memory

**Files:**
- Modify: `~/.claude/projects/-Users-kumarthakkar-Documents-Claude-Projects-Lobby-Connect/memory/project-status.md`

Tag the completion of Plan 2 and update the project-status memory so future sessions orient correctly.

- [ ] **Step 1: Confirm clean tree and full log.**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

Run: `git log --oneline -12`
Expected: top of log shows the 11 Plan-2 commits in order (Tasks 1 → 11) ending with the foundation tag commit beneath.

- [ ] **Step 2: Tag the milestone.**

Run:
```bash
git tag -a plan-02-database-rls-complete -m "Plan 2: database schema, RLS, seed, TS types"
```

- [ ] **Step 3: Push branch + tag to origin.**

Run:
```bash
git push origin main
git push origin plan-02-database-rls-complete
```

Expected: both push without error.

- [ ] **Step 4: Update `project-status.md` memory.**

Replace the current contents of `~/.claude/projects/-Users-kumarthakkar-Documents-Claude-Projects-Lobby-Connect/memory/project-status.md` with:

```markdown
---
name: project-status
description: "Current build phase and what's been completed vs. what's next"
metadata:
  node_type: memory
  type: project
  originSessionId: c6180df9-da6f-40b3-b777-ec05146e2d59
---

Plan 2 (Database & RLS) is complete as of 2026-05-27. Tag `plan-02-database-rls-complete` on `main`, pushed to GitHub.

**Why:** Schema + RLS had to land before any auth or business code could read/write tables safely.

**What was built:**
- `supabase/migrations/0001_init.sql` — pgcrypto, RLS helpers, 8 tables + indexes, updated_at triggers, 3 storage buckets
- `supabase/migrations/0002_rls.sql` — RLS enabled on all 8 tables, 17 policies total (14 table + 3 storage)
- `supabase/seed.sql` — idempotent local seed (1 operator, 1 admin auth user `admin@lobbyconnect.local` / `localdev123`, 1 sample property, 1 operator setting)
- `packages/shared/src/supabase-types.ts` — hand-written `Database` type, string-union types for CHECK columns, named row aliases (`Profile`, `Property`, etc.)
- `packages/shared/src/index.ts` updated to re-export the types

**Not yet done (deferred):**
- Local apply (`supabase start` + `supabase db reset`) — gated on Docker Desktop install
- Remote Supabase project linking + type regeneration via `supabase gen types`

**Next plan:** Plan 3 — Auth & role routing (Supabase SSR client, middleware gate, sign-in/onboarding pages, role-grouped route layouts).

**How to apply:** Use this to orient at session start. Verify with `git describe --tags --abbrev=0` and `git log --oneline -5`.
```

- [ ] **Step 5: Verify memory file written.**

Run: `head -10 ~/.claude/projects/-Users-kumarthakkar-Documents-Claude-Projects-Lobby-Connect/memory/project-status.md`
Expected: first line is `---`, the YAML frontmatter is intact, and "Plan 2 (Database & RLS) is complete" appears.

(No git commit needed for the memory file — it lives outside the repo.)

---

## Post-plan follow-up (NOT part of this plan)

After Docker Desktop is installed:

1. From repo root: `pnpm supabase start`
2. `pnpm supabase db reset` — applies both migrations + seed.sql against the fresh local DB.
3. Spot-check: `pnpm supabase db psql -c "select email, role from profiles;"` — should return one row `admin@lobbyconnect.local | ADMIN`.
4. Spot-check storage: `pnpm supabase db psql -c "select id, public from storage.buckets;"` — should return 3 rows.

If any migration step errors, the SQL needs fixing — re-edit the relevant migration, `pnpm supabase db reset` again until clean.

---

*End of Plan 2.*
