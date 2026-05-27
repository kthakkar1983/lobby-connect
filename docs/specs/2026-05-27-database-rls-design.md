# Plan 2 — Database & RLS Design

**Status**: Approved 2026-05-27
**Authors**: Kumar Thakkar + Claude
**Parent spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (sections 5 + 6)
**Predecessor**: Plan 1 (Foundation) — tag `plan-01-foundation-complete`

---

## 1. Purpose

Translate the schema and RLS policy matrix from the v1 architecture spec into runnable SQL migrations, a local-dev seed, and matching TypeScript types — so subsequent plans (auth, admin CRUD, call routing) have a working database to build against.

This document does **not** re-specify the schema. The architecture spec is the source of truth for what tables exist, what columns they have, and what RLS rules apply. This document only locks down **how** that schema gets expressed as SQL and TS, and the few mechanical decisions the architecture spec didn't make.

---

## 2. Scope

**In:**
- `supabase/migrations/0001_init.sql` — extensions, tables, indexes, storage buckets, `updated_at` trigger, RLS helper functions
- `supabase/migrations/0002_rls.sql` — `alter table ... enable row level security` + all policies (table policies + storage policies)
- `supabase/seed.sql` — idempotent seed: one operator, one admin auth user + matching profile, one sample property
- `packages/shared/src/supabase-types.ts` — hand-written TypeScript type definitions matching the eventual `supabase gen types` output shape
- `packages/shared/src/index.ts` — export the new types module
- Commit all of the above to `main`

**Out (deferred to a follow-up step):**
- Installing Docker Desktop
- Running `supabase start` + `supabase db reset` locally
- Linking to a remote Supabase project
- Regenerating types from the live DB

**Explicitly out of scope (later plans):**
- Any application code that reads/writes these tables
- Auth invitation API routes
- Twilio webhook routes that touch `calls`

---

## 3. File Layout

```
supabase/
├── config.toml              ← unchanged from Plan 1
├── migrations/
│   ├── 0001_init.sql        ← NEW: schema
│   └── 0002_rls.sql         ← NEW: row-level security
├── seed.sql                 ← NEW: local dev data
└── functions/               ← unchanged, empty

packages/shared/src/
├── index.ts                 ← MODIFIED: re-export supabase-types
├── version.ts               ← unchanged
└── supabase-types.ts        ← NEW: hand-written DB types
```

---

## 4. Locked Decisions

The five non-obvious mechanical decisions called out during brainstorming:

### 4.1 Storage buckets created via SQL `INSERT`

Buckets are rows in `storage.buckets`. We create them in `0001_init.sql` with `INSERT ... ON CONFLICT (id) DO NOTHING` so the migration is re-runnable. Storage RLS policies live in `0002_rls.sql` alongside the table policies.

The three buckets from architecture spec §5.9:

| id | name | public | Policy summary |
|---|---|---|---|
| `playbooks` | `playbooks` | `false` | Admins of operator can read/write; signed URLs issued by portal API for agents |
| `logos` | `logos` | `true` | Admins write, public reads |
| `audio` | `audio` | `true` | Admins write, public reads |

### 4.2 `updated_at` auto-update via shared trigger

One trigger function defined in `0001_init.sql`:

```sql
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

Attached to every table that has an `updated_at` column: `profiles`, `properties`, `admin_call_availability`, `operator_settings`. (`calls` has no `updated_at`; lifecycle fields like `ended_at` are set explicitly by webhooks. `audit_logs` and `operators` are append-only.)

### 4.3 RLS helper functions

Two `security definer` helper functions defined in `0001_init.sql` and used throughout `0002_rls.sql`:

```sql
create or replace function current_user_operator_id()
returns uuid language sql stable security definer
set search_path = public as $$
  select operator_id from profiles where id = auth.uid()
$$;

create or replace function current_user_role()
returns text language sql stable security definer
set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
```

`security definer` + a pinned `search_path` is required to avoid the policies hitting their own recursion when they read `profiles`. `stable` lets Postgres cache the result within a query. Both functions return `null` for the service role (no `auth.uid()`), which is harmless because service-role queries bypass RLS entirely.

### 4.4 Seed auth user creation

Seeding requires the local `pgcrypto` extension (already enabled in Supabase). The seed inserts directly into `auth.users` with a `crypt()`-hashed password, then inserts the matching `profiles` row in the same transaction.

Pattern:

```sql
insert into auth.users (id, email, encrypted_password, email_confirmed_at, ...)
values (
  '00000000-0000-0000-0000-000000000001',
  'admin@lobbyconnect.local',
  crypt('localdev123', gen_salt('bf')),
  now(),
  ...
)
on conflict (id) do nothing;
```

Idempotency via fixed UUIDs + `on conflict do nothing`. Password `localdev123` is for local-only — the seed file will say so in a header comment. The seed never runs against a remote DB.

### 4.5 TS types shape matches generated output

`packages/shared/src/supabase-types.ts` exports a `Database` type with the same nested shape Supabase's CLI produces, so a future swap to generated types is a file replacement, not a refactor:

```ts
export type Database = {
  public: {
    Tables: {
      operators: {
        Row: { id: string; name: string; slug: string; created_at: string };
        Insert: { id?: string; name: string; slug: string; created_at?: string };
        Update: { id?: string; name?: string; slug?: string; created_at?: string };
      };
      // ... one entry per table
    };
    Enums: Record<string, never>;
  };
};

// Convenience aliases used throughout the app:
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
```

`text` + `CHECK` constrained columns (`role`, `status`, `state`, `channel`, `actor_type`) are typed as TypeScript string unions to give the app actual type safety:

```ts
export type Role = 'AGENT' | 'ADMIN' | 'OWNER';
export type ProfileStatus = 'AVAILABLE' | 'ON_CALL' | 'OFFLINE';
export type CallChannel = 'AUDIO' | 'VIDEO';
export type CallState = 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_ANSWER' | 'FAILED';
export type ActorType = 'USER' | 'SYSTEM';
```

These string-union types are referenced inside the `Database` tables (e.g. `role: Role`) instead of widening to `string`.

---

## 5. Migration Ordering

`0001_init.sql` must satisfy FK ordering: `operators` → `profiles` → `properties` → `property_assignments` + `admin_call_availability` → `calls` → `audit_logs` → `operator_settings`.

Within the file:
1. `create extension if not exists pgcrypto;` (for `gen_random_uuid()` and seed `crypt()`)
2. Helper functions (`set_updated_at`, `current_user_operator_id`, `current_user_role`)
3. Tables in FK order with their indexes co-located
4. `updated_at` triggers
5. Storage bucket inserts

`0002_rls.sql` order:
1. `alter table ... enable row level security` on all 8 public tables
2. Policies grouped by table, matching the matrix in architecture spec §6.2
3. Storage policies on `storage.objects` for the three buckets

Both files are idempotent: `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists ... ; create policy ...`. This lets a developer re-apply during iteration without `db reset`.

---

## 6. RLS Policy Translation

The architecture spec §6.2 has the matrix. This section locks the **SQL pattern** for each row of that matrix so the migration writer doesn't have to invent it.

**Pattern A — same-operator scoped SELECT:**
```sql
create policy "select_same_operator" on <table>
  for select to authenticated
  using (operator_id = current_user_operator_id());
```

**Pattern B — admin-only mutation:**
```sql
create policy "admin_mutate" on <table>
  for all to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN')
  with check (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

**Pattern C — agent sees only assigned properties:**
```sql
create policy "agent_select_assigned_properties" on properties
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() in ('ADMIN', 'OWNER')
      or exists (
        select 1 from property_assignments pa
        where pa.property_id = properties.id
          and pa.primary_agent_id = auth.uid()
          and (pa.effective_until is null or pa.effective_until > now())
      )
    )
  );
```

**Pattern D — owner sees only owned properties:**
Folded into Pattern C above via the `current_user_role() in ('ADMIN', 'OWNER')` short-circuit plus an `owner_user_id = auth.uid()` branch. Owners always belong to the same operator, so the operator filter still applies.

**Pattern E — service-role-only writes:** No policy needed. RLS denies by default; service role bypasses RLS. (We still `enable row level security` so the authenticated role can't accidentally write.)

**Storage policies** follow the same patterns, scoped via the bucket name and the object's path. Logos and audio are public-read, admin-write. Playbooks are admin read/write only; agents access via signed URLs issued by the portal API (service role).

---

## 7. Seed Contents

Single transaction, idempotent on re-run:

- 1 operator: `Lobby Connect` (slug: `lobby-connect`), fixed UUID
- 1 admin auth user: `admin@lobbyconnect.local` / `localdev123`, fixed UUID, email pre-confirmed
- 1 admin profile linked to that auth user + operator
- 1 sample property: `The Sample Hotel`, with a `routing_did` and timezone, owned by the admin (acceptable for v1 dev — owner profiles aren't seeded)
- 1 `operator_settings` row: `default_max_ring_seconds = 120`

No assignments, no calls, no audit log entries. Those exist as test data needs surface in later plans.

The seed file opens with a comment block stating: local-dev only, password is intentionally weak, never commit modifications that personalize this data.

---

## 8. TypeScript Types

One file: `packages/shared/src/supabase-types.ts`. Exports:

- `Database` — top-level type matching `supabase gen types` shape
- `Tables<T>`, `TablesInsert<T>`, `TablesUpdate<T>` — generic accessors
- Named row aliases for ergonomic imports: `Operator`, `Profile`, `Property`, `PropertyAssignment`, `AdminCallAvailability`, `Call`, `AuditLog`, `OperatorSettings`
- Named string-union types: `Role`, `ProfileStatus`, `CallChannel`, `CallState`, `ActorType`

`packages/shared/src/index.ts` re-exports everything from `supabase-types`. No runtime code is added to the shared package in Plan 2.

---

## 9. Verification

Plan 2 ends with files written and committed. Verification (local apply) is a follow-up step gated on Docker install:

1. Install Docker Desktop
2. From repo root: `pnpm supabase start`
3. `pnpm supabase db reset` — runs both migrations + seed against the fresh local DB
4. Confirm: no SQL errors, all 8 tables exist, all RLS policies attached, storage buckets present, seed rows queryable
5. Spot-check: connect to the local Postgres (`pnpm supabase db psql`) and run `select * from profiles;` — should return the seeded admin row
6. `pnpm typecheck` — confirms `supabase-types.ts` compiles cleanly across the workspace

If any step fails, fix in place and re-run `db reset` until clean.

---

## 10. Non-Goals / Won't-Do

- **No app-code consumption** of the new types in Plan 2. We're writing types, not wiring them. First consumer is Plan 3 (auth).
- **No remote Supabase project** linked yet. That happens when we're ready to deploy preview environments.
- **No realtime publication tweaks.** v1 doesn't use Supabase Realtime (locked decision #8). Default publication is fine.
- **No partitioning, no materialized views.** Pilot scale doesn't need them and the architecture spec doesn't call for them.
- **No `set_config()`-based tenancy switching.** Single-operator in v1; multi-tenant query-layer filter is a v2 concern (locked decision #10).

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| RLS helper functions cause infinite recursion when policies on `profiles` call them | Helpers use `security definer` + pinned `search_path`; policies on `profiles` use `auth.uid()` directly, not the helpers |
| Hand-written TS types drift from actual DB schema | Once we link a remote Supabase project, switch to generated types — this file's structure makes that a 1-file replacement |
| Seed password leaks into prod | Seed runs only against local Supabase (`supabase db reset`), never against linked remote. File header states this. |
| Storage bucket policies forgotten | They live in `0002_rls.sql` next to table policies — single place to review |
| Forgetting to `enable row level security` on a table | Migration explicitly enables RLS on every table by name, no shortcuts |

---

*End of Plan 2 design.*
