# Plan 8 — Observability Design Spec

**Parent spec:** `docs/specs/2026-05-27-v1-architecture-design.md` §10 (Observability) + §12 (forward-compat checklist)
**Builds on:** every prior plan. Reads existing `audit_logs`, `calls`, `profiles`; adds one new table (`health_signals`). The final v1 plan.

## Goal

Make the running system legible to an admin along three axes — **errors** (Sentry), **what changed** (`/audit`), and **at-a-glance health** (`/status`) — built as a general, multi-tenant-ready observability layer rather than pilot-only shims. Vercel/Supabase logs are external dashboards (nothing to build); this plan builds the three surfaces that need code.

## Organizing principle

**Two signal kinds, one extensible registry.**

- **Push signals** self-report into a generic `health_signals` heartbeat table — every background job/integration stamps `last_ok_at` for its own `signal` key. Adding a new monitored job later is one `recordHeartbeat()` call + one threshold entry; `/status` renders it automatically. Multi-tenant by construction (`operator_id` on every row).
- **Pull signals** are probed live at render time (Supabase round-trip, Sentry error count) — no storage, always current.

This avoids the two pilot-minded shortcuts rejected in the 2026-06-03 brainstorm: deriving Twilio health from the `calls` table (meaningless on a quiet day) and stuffing a cron timestamp into `operator_settings` (a one-off, not a registry).

## Decisions

1. **Single plan, dependency-ordered build: Sentry → `/audit` → `/status`.** Sentry first so error plumbing exists; `/audit` next (pure read viewer over an already-populated table); `/status` last so it can read a real Sentry count and the heartbeats the first two steps establish.
2. **Sentry in both apps, with PII scrubbing.** `@sentry/nextjs` (portal: client + server + edge) and `@sentry/react` (kiosk). A `beforeSend` hook drops `caller_number` and `recording_url` and redacts phone-shaped substrings from event payloads + breadcrumbs, so guest PII never leaves our infra. Conservative `tracesSampleRate` (0.1), tunable by env.
3. **Generic `health_signals` registry** (see migration) for push signals — not ad-hoc derivations. Severity is per-signal and lives in code, so thresholds tune without a migration and the stored row stays minimal (`last_ok_at` + optional `details`).
4. **`/status` error count = live Sentry API count + deep-link, with graceful fallback.** A server-only call fetches unresolved-issue count for the last 24 h and renders it with a status color + "View in Sentry" link. If the API is slow/unreachable/unconfigured, the card **degrades to link-only** and the page still renders — option B's reliability for free.
5. **`/audit` data layer takes a full filter object** `{ action?, actorId?, entityType?, from?, to?, cursor, limit }`. The v1 UI exposes only an action-type filter + "Load more"; date-range / actor / entity filtering is later a pure UI add against the same helper.
6. **Both pages are admin-only**, under the existing `(admin)` route group, gated by `requireRole("ADMIN")` — same guard as the rest of `/admin/*`. New sidebar nav items. Owners/agents never see them.
7. **No in-app alerting in v1** (YAGNI). Sentry's own email-on-new-issue (configured in the Sentry dashboard, not our code) covers proactive notification. The `health_signals` registry + Sentry are the structured data a future PagerDuty/Slack notifier polls — the §12 seam, left open, no empty scaffolding.
8. **Vercel Analytics** is added as the one-line `@vercel/analytics` layer in the portal root layout (completes spec §10's "Vercel Analytics" row).

## Migration `0011_health_signals.sql`

Adds one table + RLS. No other schema changes.

```sql
create table if not exists health_signals (
  operator_id uuid not null references operators(id),
  signal      text not null,          -- 'twilio_webhook', 'cron_mark_stale_offline', ...
  last_ok_at  timestamptz,
  details     jsonb,
  updated_at  timestamptz not null default now(),
  primary key (operator_id, signal)
);

alter table health_signals enable row level security;

-- Admins of the operator may read their own operator's signals. Writes are
-- service-role only (webhooks + cron), which bypasses RLS — so no write policy.
create policy health_signals_admin_select on health_signals
  for select to authenticated
  using (operator_id = current_user_operator_id() and current_user_role() = 'ADMIN');
```

`current_user_operator_id()` / `current_user_role()` are the existing `0001` SECURITY DEFINER helpers (no recursion risk — `health_signals` is not cross-referenced by another policy). `packages/shared/src/supabase-types.ts` is regenerated for the new table.

## Feature 1 — Sentry + Vercel Analytics

- **Portal (`@sentry/nextjs`):** `instrumentation.ts` (server + edge via `register`/`onRequestError`), `instrumentation-client.ts` (browser), and `withSentryConfig` wrap in `next.config.ts` (source-map upload using `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` at build). `tracesSampleRate: 0.1`.
- **Kiosk (`@sentry/react`):** `Sentry.init(...)` in `src/main.tsx`, DSN from `VITE_SENTRY_DSN` (public client DSN — expected and fine for a tablet SPA).
- **`lib/sentry/scrub.ts` (pure, TDD-first):** `scrubEvent(event)` removes `caller_number`/`recording_url` keys anywhere in `extra`/`contexts`/`request`, and redacts phone-shaped substrings (`/\+?\d[\d\s().-]{7,}\d/` → `[redacted]`) across message + breadcrumb text. Wired as each app's `beforeSend`. One tested helper, imported by both SDK configs.
- **`@vercel/analytics`:** `<Analytics />` from `@vercel/analytics/next` in the portal root layout.
- **Env (both `.env.example` files updated):** portal — `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`; kiosk — `VITE_SENTRY_DSN`. The auth token is **server/build-only**, never `NEXT_PUBLIC`.

## Feature 2 — `/admin/audit` page

- **`lib/audit/query.ts` (pure, TDD-first):**
  - `validateAuditFilter(searchParams)` → a normalized `AuditFilter` object (clamps `limit`, parses optional `action`/`entityType`/`from`/`to`/`cursor`).
  - `mergeActorNames(rows, profiles)` → rows decorated with `actorName` (the established **2-query** pattern: fetch log rows, then fetch `profiles` for the distinct `actor_user_id`s and merge client-side). `actor_type = 'SYSTEM'` or null actor → `"System"`.
- **`app/(admin)/admin/audit/page.tsx` (RSC):** `requireRole("ADMIN")` → user-scoped `audit_logs` select (operator-scoped by RLS), filtered per `AuditFilter`, **keyset-paginated** on `(created_at desc, id desc)`, page size 50 → resolve actor profiles → `mergeActorNames` → pass to the table.
- **`audit-table.tsx` (client):** columns **Time** (relative, absolute on hover) · **Actor** · **Action** (badge) · **Entity** (`entity_type` + truncated `entity_id`) · **Details** (expandable JSON via `<details>`/popover). Owns the **action-type filter** `Select` (writes to `searchParams`) and the **"Load more"** button (advances the keyset cursor) — mirrors the owner call-history paging UX.
- **Nav:** new `app-sidebar.tsx` item → `/admin/audit` (lucide `ScrollText`).

## Feature 3 — `/admin/status` page

- **`lib/status/signals.ts` (pure, TDD-first):**
  - `SIGNAL_SPECS` — per-signal `{ label, mode, warnAfterMs?, downAfterMs? }`. `mode: 'liveness'` (e.g. `cron_mark_stale_offline`: warn > 90 s, down > 5 min — it runs every minute) or `mode: 'info'` (e.g. `twilio_webhook`: green if ever seen, grey if never; no down threshold, because a quiet pilot legitimately has no inbound calls).
  - `classifyHeartbeat(lastOkAt, now, spec)` → `'ok' | 'warn' | 'down' | 'unknown'`.
  - `classifyProbe(result)` and `classifyErrorCount(count)` → pure status mappers for the two pull signals.
- **`lib/sentry/errors.ts` (pure-ish, TDD-first):** `getRecentErrorCount()` → calls the Sentry API (org/project from env, server-only token) for unresolved issues in the last 24 h; returns `number` on success, `null` on any failure/missing-config. The parse logic is unit-tested with a mocked response.
- **`lib/health/heartbeat.ts` (pure-ish, TDD-first):** `recordHeartbeat(operatorId, signal, details?)` → service-role `upsert` into `health_signals` (`last_ok_at = now()`). Best-effort: callers wrap in try/catch and never block their primary work.
- **`app/(admin)/admin/status/page.tsx` (RSC):** `requireRole("ADMIN")` → gather in parallel: a Supabase `select 1` probe (with timeout), `getRecentErrorCount()` (try/catch → number | null), and a user-scoped `health_signals` select for the operator → `classify*` (pure) → render `<StatusCard>` per signal (label, status dot green/amber/red/grey, value or relative time, optional link). Wraps the cards in `<AutoRefresh>` (20 s + refetch-on-focus). Each probe degrades independently — one failing card never throws the page.
- **Heartbeat writers:**
  - `app/api/twilio/voice/incoming/route.ts` → best-effort `recordHeartbeat(operatorId, 'twilio_webhook')` (operator resolved from the matched property). Off the critical path of the TwiML response.
  - `app/api/cron/mark-stale-offline/route.ts` → after the OFFLINE sweep, `recordHeartbeat(op.id, 'cron_mark_stale_offline')` for each operator (`select id from operators`; one operator in v1, but the per-operator loop keeps the registry multi-tenant-correct).
- **Nav:** new `app-sidebar.tsx` item → `/admin/status` (lucide `Activity`).
- **`<AutoRefresh>` promotion:** relocate `components/owner/auto-refresh.tsx` → `components/auto-refresh.tsx` (it is no longer owner-specific) and update the owner imports. Pure move, no behavior change.

## Data flow

1. **Errors:** any thrown error (client/server/edge, portal + kiosk) → Sentry SDK → `beforeSend` = `scrubEvent` (strip PII) → sentry.io.
2. **Heartbeats:** Twilio incoming webhook + cron → `recordHeartbeat()` service-role upsert → `health_signals`.
3. **`/status` render:** `requireRole("ADMIN")` → parallel [Supabase probe, Sentry count (try/catch), `health_signals` select] → pure `classify*` → cards; `<AutoRefresh>` re-renders on a 20 s tick + focus.
4. **`/audit` render:** `requireRole("ADMIN")` → filtered keyset `audit_logs` select (RLS operator-scoped) → 2-query profile merge → table; "Load more" advances the cursor.

## Cross-cutting

- **Styling:** Tailwind tokens only, light mode (admin portal is desktop per the cut list — not mobile-responsive). No hardcoded hex.
- **Loading:** skeletons with the standard 10 s timeout; `/status` cards show a "checking…" state until their probe resolves.
- **Resilience:** `/status` probes are individually guarded — Supabase down, Sentry unreachable, or no heartbeats yet each render as their own `down`/`unknown` card, never a 500.
- **Security:** Sentry auth token is server/build-only; `health_signals` is admin-read via RLS; guest PII is scrubbed before any Sentry send. No new service-role surface beyond the two best-effort heartbeat writes (already service-role contexts).
- **Audit:** `/audit` and `/status` are read-only — no new audit actions, and reads are not themselves audited (avoid log noise).

## Testing

- **Pure helpers (Vitest, TDD-first):** `lib/sentry/scrub.ts` (drops `caller_number`/`recording_url`, redacts phone patterns, leaves benign data intact), `lib/sentry/errors.ts` (parse count from a mocked Sentry response; any error → `null`), `lib/status/signals.ts` (`classifyHeartbeat`/`classifyProbe`/`classifyErrorCount` across ok/warn/down/unknown + `info` vs `liveness` modes), `lib/audit/query.ts` (`validateAuditFilter` clamping/parsing; `mergeActorNames` incl. SYSTEM/null actor), `lib/health/heartbeat.ts` (upsert payload shape; swallows errors).
- **Route tests:** extend `app/api/twilio/voice/incoming` and `app/api/cron/mark-stale-offline` tests to assert a heartbeat upsert is attempted and that a heartbeat failure does **not** fail the primary response.
- **Manual smoke:**
  - Throw a deliberate error in portal and in kiosk → both appear in Sentry, and the event payload contains **no** phone number or recording URL.
  - `/admin/audit` lists recent events with actor names; the action-type filter narrows; "Load more" pages back in time.
  - `/admin/status`: Supabase card green; Sentry card shows a count + link, and with the token removed it falls back to link-only while the page still renders; place a test call → the `twilio_webhook` card updates to "just now"; the cron card is green and goes amber if the cron is paused.
  - **Negative:** an agent or owner navigating to `/admin/status` or `/admin/audit` is redirected by `requireRole`.

## Files

```
supabase/migrations/0011_health_signals.sql           ← table + admin-select RLS
apps/portal/
  instrumentation.ts                                  ← Sentry server + edge init
  instrumentation-client.ts                           ← Sentry browser init
  next.config.ts                                      ← withSentryConfig wrap
  app/layout.tsx                                       ← <Analytics /> (Vercel)
  lib/sentry/
    scrub.ts        scrubEvent (PII)                  (+ tests/sentry/scrub.test.ts)
    errors.ts       getRecentErrorCount               (+ tests/sentry/errors.test.ts)
  lib/status/
    signals.ts      SIGNAL_SPECS + classify*          (+ tests/status/signals.test.ts)
  lib/health/
    heartbeat.ts    recordHeartbeat                   (+ tests/health/heartbeat.test.ts)
  lib/audit/
    query.ts        validateAuditFilter, mergeActorNames (+ tests/audit/query.test.ts)
  app/(admin)/admin/audit/
    page.tsx        ← RSC fetch + 2-query merge
    audit-table.tsx ← filter + load-more (client)
  app/(admin)/admin/status/
    page.tsx        ← RSC probes + heartbeats
    status-card.tsx ← single health card (client/server)
  app/api/twilio/voice/incoming/route.ts              ← + best-effort twilio_webhook heartbeat
  app/api/cron/mark-stale-offline/route.ts            ← + per-operator cron heartbeat
  components/app-sidebar.tsx                           ← + Audit + Status nav items
  components/auto-refresh.tsx                          ← promoted from components/owner/
  .env.example                                         ← Sentry vars
apps/kiosk/
  src/main.tsx                                         ← Sentry.init + scrubEvent
  src/lib/sentry-scrub.ts (or shared)                  ← kiosk beforeSend
  .env.example                                         ← VITE_SENTRY_DSN
packages/shared/src/supabase-types.ts                 ← regen for health_signals
```

(Final file list is the plan's job; this is the expected shape.)

## Forward-compat seams

| Later feature | Seam in 8 |
|---|---|
| Multi-tenant SaaS | `health_signals.operator_id` + per-operator heartbeats; `/status` and `/audit` already operator-scoped by RLS. |
| New monitored job/integration | Add one `recordHeartbeat('<signal>')` call + one `SIGNAL_SPECS` entry → it renders on `/status` automatically. No schema change. |
| PagerDuty / Slack alerting | A notifier polls `health_signals` (status transitions) + Sentry (new issues); home is `lib/integrations/`. No schema change — the §12 hook. |
| Richer `/audit` filtering (date / actor / entity) | `AuditFilter` already carries the fields; UI-only addition. |
| Ops dashboard | `(ops)` route group reuses `<StatusCard>` + the same tables/probes. |
| Log drains / OpenTelemetry | The portal `instrumentation*.ts` files are the standard injection point. |
```
