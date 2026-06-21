# Staging Environment Implementation Plan

> **For agentic workers:** This is an **infrastructure** plan (Supabase project + git branch + Vercel env vars), executed **collaboratively** — many steps need Kumar's Supabase/Vercel dashboard or a cost confirmation. Steps are labelled **[Claude]**, **[Kumar]**, or **[Both]**. Do NOT dispatch subagents; run inline with checkpoints. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up a persistent, prod-shaped **staging** environment — a new free Supabase project + a `staging` git branch deploying both apps to branch-scoped Vercel preview URLs — so v1.1 work (caching, session expiry, DB queries) can be tested and previewed without touching prod.

**Architecture:** New Supabase project `lobby-connect-staging` (migrated `0001–0017`, throwaway seed). Long-lived `staging` git branch → Vercel auto-deploys both `lobby-connect-portal` and `lobby-connect-kiosk` as previews, with environment variables scoped to the `staging` branch and pointed at the staging Supabase project. Telephony (Twilio/Agora) and Sentry are deferred-unset. Promote `staging` → `main` → prod.

**Tech Stack:** Supabase (Postgres + Auth), Supabase MCP (`apply_migration`/`execute_sql`/`create_project`), Vercel (Hobby, branch-scoped Preview env vars), git, GoTrue admin API (curl).

**Spec:** `docs/specs/2026-06-21-versioning-and-staging-design.md`

> **Scoping refinement vs spec §4.3:** the spec suggested scoping the staging DB vars to *all* Preview branches (so every PR preview shares the staging DB). During planning this was found to break the cross-app URL vars (`NEXT_PUBLIC_APP_URL`/`KIOSK_ORIGIN`/`VITE_PORTAL_API_URL`), which are URL-specific per preview. **Decision:** scope ALL staging vars to the **`staging` branch only**, giving one clean, self-consistent environment. Broadening DB vars to all previews is a documented later option (Task 14).

---

## File / resource map

| Resource | Created/changed by | Responsibility |
|---|---|---|
| Supabase project `lobby-connect-staging` | Task 2 | Throwaway prod-shaped DB |
| `supabase/seed-staging.sql` (new) | Task 5 | Sample property + operator setting for staging (idempotent) |
| `staging` git branch | Task 7 | Trigger for staging preview deploys |
| Vercel env vars (portal + kiosk, Preview/`staging`) | Tasks 8, 11 | Point staging deploys at staging Supabase |
| `docs/setup/2026-06-21-staging-runbook.md` (new) | Task 15 | How to use/refresh staging (un-pause, re-sync, env matrix) |
| `memory/project-status.md` (append) | Task 15 | Record staging exists |

---

## Phase 0 — Prerequisite

### Task 1: Confirm the staging project is free **[Both]**

- [ ] **Step 1: Check cost** — [Claude] call Supabase MCP `get_cost` with `type: "project"`, `organization_id: "qrpnbimuziaoekoznfxm"`.
- [ ] **Step 2: Confirm with Kumar** — [Both] expected `$0` (org has 1 active project `lobby-connect-prod` + 1 paused `Back of House`; paused don't count, so this is active #2). If `get_cost` reports any non-zero amount, STOP and report — do not create. Get Kumar's explicit "go ahead".

---

## Phase 1 — Supabase staging project

### Task 2: Create the staging project **[Claude, after Task 1 confirm]**

- [ ] **Step 1: Create** — call Supabase MCP `create_project` with:
  - `name: "lobby-connect-staging"`
  - `organization_id: "qrpnbimuziaoekoznfxm"`
  - `region: "us-east-1"` (match prod)
  - `confirm_cost_id`: from the Task 1 `get_cost` call.
- [ ] **Step 2: Wait for healthy** — poll Supabase MCP `list_projects` until the new ref shows `status: "ACTIVE_HEALTHY"` (provisioning takes a few minutes).
- [ ] **Step 3: Capture identifiers** — record the new project **ref** (the `<staging-ref>` used throughout). Get the API URL via MCP `get_project_url` and the anon/publishable key via MCP `get_publishable_keys`. Note both.

### Task 3: Get the staging service-role key **[Kumar]**

The MCP does not expose the secret service-role key; only the dashboard does.

- [ ] **Step 1:** In the **staging** project dashboard → **Project Settings → API → Project API keys**, copy the **`service_role`** secret.
- [ ] **Step 2:** Paste it to Claude (used for Vercel env in Task 8 and the admin-create curl in Task 4). Treat as a secret — it goes only into Vercel env, never a committed file.

### Task 4: Bootstrap the operator + first admin **[Claude]**

Mirrors `supabase/bootstrap-prod.sql`, but staging creates the admin auth user via the GoTrue admin API (no dashboard click needed) since this is throwaway.

- [ ] **Step 1: Apply all migrations** — for each file in `supabase/migrations/` in ascending order (`0001_init.sql` → `0017_audit_action_index.sql`, 17 files), call Supabase MCP `apply_migration` against `<staging-ref>` with `name` = the filename (minus `.sql`) and `query` = the file contents. Apply strictly in order.
- [ ] **Step 2: Verify schema** — MCP `list_tables` on `<staging-ref>`; expected tables include `operators`, `profiles`, `properties`, `property_assignments`, `calls`, `incidents`, `audit_logs`, `health_signals`. Confirm `audit_logs` has the `0017` index via `execute_sql`: `select indexname from pg_indexes where tablename='audit_logs';` → expect an index covering `(operator_id, action, created_at)`.
- [ ] **Step 3: Create the staging admin auth user** — run (paste the Task 2 URL + Task 3 service-role key; pick a staging password):

```bash
STAGING_URL="https://<staging-ref>.supabase.co"
SR_KEY="<staging-service-role-key>"
curl -sS -X POST "$STAGING_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "apikey: $SR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@staging.lobbyconnect.local","password":"StagingAdmin!2026","email_confirm":true}'
```

Expected: JSON with an `"id"` (the new user UUID). Record it as `<ADMIN_UUID>`.

- [ ] **Step 4: Wire operator + admin profile** — MCP `execute_sql` against `<staging-ref>` (adapted from `bootstrap-prod.sql`, `<ADMIN_UUID>` substituted):

```sql
begin;
insert into operators (id, name, slug)
values (gen_random_uuid(), 'Lobby Connect (Staging)', 'lobby-connect')
on conflict (slug) do nothing;

insert into profiles (id, operator_id, role, full_name, email, status, active)
values ('<ADMIN_UUID>',
        (select id from operators where slug='lobby-connect'),
        'ADMIN', 'Staging Admin', 'admin@staging.lobbyconnect.local', 'OFFLINE', true)
on conflict (id) do update set role='ADMIN', active=true, operator_id=excluded.operator_id;

update profiles set twilio_identity = 'lc_' || replace(id::text,'-','')
 where role in ('ADMIN','AGENT') and twilio_identity is null;

insert into operator_settings (operator_id, key, value)
values ((select id from operators where slug='lobby-connect'), 'default_max_ring_seconds', '120')
on conflict (operator_id, key) do nothing;
commit;
```

- [ ] **Step 5: Verify** — `execute_sql`: `select role, active, must_change_password from profiles where id='<ADMIN_UUID>';` → expect `ADMIN, true, false`. (`must_change_password` is `false` because the admin API created the user directly, not via the provisioning flow — so the admin can sign in straight to the dashboard.)

### Task 5: Add a sample property (committed seed) **[Claude]**

A property needs no auth user, so it goes in via SQL. Commit the file so staging is reproducible.

- [ ] **Step 1: Write** `supabase/seed-staging.sql`:

```sql
-- Lobby Connect — STAGING seed (throwaway data; safe to re-run).
-- Run AFTER migrations + the staging operator bootstrap exist.
insert into properties (id, operator_id, name, timezone, routing_did, active)
values (
  '00000000-0000-0000-0000-0000000000c1',
  (select id from operators where slug='lobby-connect'),
  'Staging Test Hotel',
  'America/Chicago', '+15555550100', true
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply** — MCP `execute_sql` against `<staging-ref>` with the file contents.
- [ ] **Step 3: Verify** — `select name, timezone from properties;` → expect `Staging Test Hotel, America/Chicago`.

> Note: `routing_did` is a dummy number — staging has no Twilio, so it is never dialed. Columns verified against `0001_init.sql`: `properties` has **no** `address` column; `operator_id`/`name`/`timezone` are the only NOT-NULL columns without defaults. The `kiosk_*` columns are nullable and `kiosk_cta_style` defaults to `warm`, so none need a value here.

- [ ] **Step 4: Commit** the seed file:

```bash
git add supabase/seed-staging.sql
git commit -m "chore(staging): add staging seed (sample property)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — Git staging branch

### Task 6: Confirm clean main **[Claude]**

- [ ] **Step 1:** `git checkout main && git pull --ff-only origin main` → expect up to date (tip includes the Task 5 commit).

### Task 7: Create and push the `staging` branch **[Claude]**

- [ ] **Step 1: Create + push**

```bash
git checkout -b staging
git push -u origin staging
```

Expected: branch created on origin. This triggers Vercel's first preview build on **both** projects (they may fail/redeploy later once env vars land — that's fine).
- [ ] **Step 2:** `git checkout main` (leave the working branch on main; `staging` is a deploy target, not where we develop).

---

## Phase 3 — Vercel environment + deploy

> All env vars below are scoped **Environment = Preview**, **Branch = `staging`** (Vercel dashboard: Project → Settings → Environment Variables → Add → select "Preview" → "Specific Branch" → `staging`). `NEXT_PUBLIC_*` and `VITE_*` are build-time inlined, so any change to them requires a **redeploy**, not just a save.

### Task 8: Portal env vars (known values) **[Both]**

- [ ] **Step 1: Generate two secrets** — [Claude]:

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)"
echo "KIOSK_CONFIG_SECRET=$(openssl rand -hex 32)"
```

- [ ] **Step 2: Set on `lobby-connect-portal`** (Preview/`staging`) — [Kumar in dashboard, or Claude via `vercel env add <NAME> preview staging` from the linked portal dir]. Values:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-ref>.supabase.co` (Task 2) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon/publishable key (Task 2) |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key (Task 3) |
| `CRON_SECRET` | generated (Step 1) |
| `KIOSK_CONFIG_SECRET` | generated (Step 1) |
| `EMERGENCY_DIAL_NUMBER` | `933` |

- [ ] **Step 3: Confirm deferred-unset** — do NOT set on staging: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_PHONE_NUMBER`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_READ_TOKEN`. (App loads fine without them; voice/video/Sentry simply inert on staging.)

### Task 9: First staging deploy + capture URLs **[Both]**

- [ ] **Step 1: Trigger redeploy** — [Kumar] in Vercel → `lobby-connect-portal` → Deployments → the `staging` branch deployment → Redeploy (now that env vars exist). Repeat for `lobby-connect-kiosk` (no env yet — that's Task 11; it will still build).
- [ ] **Step 2: Capture the branch URLs** — from each project's `staging` deployment page, copy the **stable branch URL** (form `lobby-connect-portal-git-staging-<scope>.vercel.app` and the kiosk equivalent). Record as `<STAGING_PORTAL_URL>` and `<STAGING_KIOSK_URL>`.

### Task 10: Portal cross-ref URL env vars **[Both]**

- [ ] **Step 1:** Set on `lobby-connect-portal` (Preview/`staging`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `<STAGING_PORTAL_URL>` |
| `KIOSK_ORIGIN` | `<STAGING_KIOSK_URL>` |

### Task 11: Kiosk env var **[Both]**

- [ ] **Step 1:** Set on `lobby-connect-kiosk` (Preview/`staging`):

| Variable | Value |
|---|---|
| `VITE_PORTAL_API_URL` | `<STAGING_PORTAL_URL>` |

- [ ] **Step 2: Confirm deferred-unset** on kiosk: `VITE_SENTRY_DSN`.

### Task 12: Final redeploy (bake in the URL vars) **[Kumar]**

- [ ] **Step 1:** Redeploy BOTH `staging` deployments again so the build-time `NEXT_PUBLIC_*` / `VITE_*` URL vars are inlined. Wait for both to reach **Ready**.

---

## Phase 4 — Verify + document

### Task 13: Acceptance checks **[Both]**

- [ ] **Step 1: Portal loads + sign-in** — [Kumar] open `<STAGING_PORTAL_URL>` (logged into Vercel, since previews sit behind Vercel's auth wall). Sign in as `admin@staging.lobbyconnect.local` / `StagingAdmin!2026`. Expect the admin dashboard.
- [ ] **Step 2: Kiosk loads** — open `<STAGING_KIOSK_URL>`. Expect the kiosk shell to render (it will show no live call path — telephony deferred — but must not crash). 
- [ ] **Step 3: Create test users via the app** — [Kumar] in staging portal → Admin → Users → create a test AGENT and a test OWNER (temp passwords). Confirms the provisioning flow works against staging.
- [ ] **Step 4: DB isolation proof** — [Claude] write a marker in staging and confirm it is absent from prod:
  - staging (`<staging-ref>`): `execute_sql` → `select count(*) from profiles;` (expect ≥ 1 — the staging admin + any test users).
  - prod (`ztunzdpmazwwwkxcpyfp`): `execute_sql` → `select count(*) from profiles where email='admin@staging.lobbyconnect.local';` → **expect 0**. Proves staging writes never touch prod.

### Task 14: Record the "broaden to all previews" follow-up **[Claude]**

- [ ] **Step 1:** Append to `docs/v2-backlog.md` a one-liner: *"Optional: broaden staging Supabase DB env vars from branch-`staging` to all Preview branches so every PR preview shares the staging DB — requires handling per-preview cross-app URL vars (use Vercel's `VERCEL_BRANCH_URL` system var instead of a fixed `NEXT_PUBLIC_APP_URL`)."*

### Task 15: Document staging **[Claude]**

- [ ] **Step 1: Write** `docs/setup/2026-06-21-staging-runbook.md` covering: the two staging URLs, the staging Supabase ref, the admin login, the env-var matrix (names + scope, NOT secret values), the **promotion flow** (`feature → staging → main → prod`, then re-sync `staging` to `main`: `git checkout staging && git reset --hard main && git push --force-with-lease origin staging`), the **un-pause** reminder (free project auto-pauses after ~7 days idle), and the note that **Vercel crons run on production only** (staging won't auto-sweep presence/reap; trigger manually with the staging `CRON_SECRET` if ever needed).
- [ ] **Step 2: Append** to `memory/project-status.md` a short "Staging environment" section: project ref, URLs, admin creds location, runbook link.
- [ ] **Step 3: Commit + push**

```bash
git checkout main
git add docs/setup/2026-06-21-staging-runbook.md docs/v2-backlog.md memory/project-status.md
git commit -m "docs(staging): runbook + status + v2 follow-up

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
git checkout staging && git reset --hard main && git push --force-with-lease origin staging && git checkout main
```

---

## Definition of done

- `lobby-connect-staging` Supabase project: ACTIVE_HEALTHY, migrated `0001–0017`, operator + admin + sample property seeded.
- `staging` git branch pushed; both apps deploy from it to stable preview URLs.
- Portal + kiosk staging env vars set (Preview/`staging`), Twilio/Agora/Sentry deferred-unset.
- Acceptance checks (Task 13) pass, including the prod-isolation proof.
- Staging runbook + status note committed; `staging` re-synced to `main`.

## Risks (from spec §6, recap)

- **Free 2-active-project ceiling** — staging is #2; no 3rd active project until Pro.
- **Auto-pause after ~7 days idle** — un-pause in the dashboard before a session (runbook).
- **Preview auth wall** — fine for Kumar; blocks external testers/webhooks (matters only when telephony is added).
- **Never `911` on staging** — `EMERGENCY_DIAL_NUMBER=933` always; Twilio unset anyway.
