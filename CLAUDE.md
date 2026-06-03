# CLAUDE.md — Lobby Connect

Auto-loaded by Claude Code at session start. Read this first, then check `MEMORY.md` and `docs/specs/` for context as needed.

## What this is

**Lobby Connect** — after-hours outsourced front-desk service for hotels. Phone routing + tablet video. Solo build (Kumar + Claude). v1 = pilot one hotel end-to-end.

## Stack

- **Portal** (`apps/portal/`): Next.js App Router on Vercel — agent + admin + owner dashboards, Twilio webhook routes, API routes for Agora tokens
- **Kiosk** (`apps/kiosk/`): Vite SPA on Vercel — tablet-locked, Agora client, no auth
- **Database/auth**: Supabase (Postgres + Auth + Storage)
- **Voice**: Twilio
- **Video**: Agora
- **Errors**: Sentry
- **Icons**: lucide-react
- **UI library**: shadcn (light mode only)
- **Styling**: Tailwind + CSS custom properties

## Where to find stuff

| File | What it owns |
|---|---|
| `docs/specs/2026-05-27-v1-architecture-design.md` | The full design spec — locked decisions, schema, routing, UI/UX baseline |
| `docs/plans/` | Implementation plans, one per major build phase |
| `docs/decisions/` | ADRs for individual locked decisions (created on demand) |
| `MEMORY.md` | Index of session-specific memories |
| `supabase/migrations/` | All SQL migrations, in order |

## v1 scope (cheat sheet)

**Ship:** phone routing, agent dashboard, admin CRUD (agents/properties/staff), owner portal (mobile responsive), kiosk video (Agora), audit log, status page.

**Cut from v1, schema-ready for later:** voicemail, voicemail callback queue, PagerDuty, ops dashboard, held-call slot, backup agent ringing, MFA, audio transcription, magic link sign-in, mobile-responsive agent/admin portals, dark mode.

## Locked decisions

1. **Routing**: parallel dial to primary agent + admins with `accepting_calls=true`, 120s window, apology TwiML on timeout. No voicemail.
2. **Roles**: AGENT, ADMIN, OWNER. Stored as text + CHECK constraint, not Postgres enum.
3. **Auth**: Supabase Auth, password only, invite-only, RLS on every table, Next.js middleware gate.
4. **Realtime**: 20s polling + refetch-on-focus + optimistic mutations. No subscriptions.
5. **UI**: light mode only. Collapsed icon-sidebar with hover-expand. Logo = home. Skeleton 10s timeout. Mobile-responsive owner portal only.
6. **Tenancy**: every table has `operator_id`. v1 is single-tenant. v2 query-layer filter unlocks multi-tenant SaaS.
7. **Forward-compat**: all cut features have schema/code-structure hooks. No destructive migrations needed to re-enable.

## Conventions

- **Never hardcode hex colors** — use Tailwind tokens (`bg-primary`, `text-text-muted`, `border-border`)
- **Never bypass RLS** in app code — use service role only in API routes that genuinely need it (Twilio webhooks, cron jobs, admin invitations)
- **All migrations** go in `supabase/migrations/` and are committed before being applied
- **Audit log** every meaningful change (create/update/delete on top-level entities, role changes, sign-in/out)
- **No emojis in code or commits** unless explicitly requested
- **Spec changes**: edit `docs/specs/*.md` files; old versions are in git history, not "v2 file"

## Deployed URLs (v1, Vercel-provided, custom domain deferred)

- Portal: `lobby-connect-portal.vercel.app`
- Kiosk: `lobby-connect-kiosk.vercel.app`

## Build status

| Plan | What it built | Tag |
|---|---|---|
| 1 — Foundation | Shell, monorepo, lint, typecheck, Vitest | `plan-01-foundation-complete` |
| 2 — Database & RLS | `0001_init.sql`, `0002_rls.sql`, `seed.sql`, TS types | `plan-02-database-rls-complete` |
| 3 — Auth & role routing | SSR clients, middleware, sign-in/out/forgot/update-password, role layouts | `plan-03-auth-routing-complete` |
| 4a — Admin layout + Users CRUD + Invite/Onboarding | Admin shell (sidebar + user menu), `/admin/users` full CRUD (invite/edit/deactivate/hard-delete), `/onboarding`, migration 0003 | `plan-04a-admin-users-complete` |
| 4b — Properties CRUD | `/admin/properties` list/create/detail+edit, shared `PropertyForm`, per-field audit, soft-delete via Active toggle, curated US timezones, migration 0004 (RLS recursion fix) | `plan-04b-properties-crud-complete` |
| 4c — Assignments + call availability | Primary-agent assignment card on property detail (assign/reassign/unassign, close-then-insert, audited), per-property `accepting_calls` toggle on `/admin` overview (optimistic, not audited), `lib/assignments/` (`planAssignmentChange`, `validateAgentId`), migration 0005 (one-active partial unique index), seed gains OWNER + 2 AGENTs | `plan-04c-assignments-availability-complete` |
| 5 | Voice path + agent dashboard — **split into 5a (backend voice) + 5b (dashboard softphone)** during 2026-05-30 brainstorm | — |
| **5a** | **Backend voice path** — Twilio webhooks (`incoming`/`dial-result`/`status`), `lib/voice/` (routing + dedup + TwiML), `lib/twilio/` (HMAC verify), `twilio_identity` consolidation onto `lc_<uuid>`. Plan: `docs/plans/2026-05-30-05a-voice-backend.md` · Twilio setup: `docs/setup/2026-05-30-twilio-voice-setup.md` | `plan-05a-voice-backend-complete` (smoke-confirmed `t13-smoke-confirmed`) |
| 5b | Agent/admin softphone (shared widget, both portals) + `/api/twilio/token` + presence (heartbeat + `AWAY` status + OFFLINE cron) + answer route (`handled_by`/`answered_at`/`IN_PROGRESS`). Spec: `docs/specs/2026-05-31-05b-agent-softphone-design.md` | spec written, plan next |
| 6a | Kiosk app + agent video split-screen (Agora), migration 0007 | `plan-06a-kiosk-video-complete` |
| 6b | Playbook — signed-URL route + PDF viewer in the agent overlay | `plan-06b-playbook-complete` |
| **6c** | **Emergency call** — real 911 via a Twilio Conference (guest + agent + 911) merged through the existing `<Dial action>` seam; PSAP routing via the number's registered E911 address; `incidents` table; agent in-call mute/leave driven server-side via the Conference Participant API (a redirected Client leg is SDK-uncontrollable); verified end-to-end with the **933** test number. Migrations 0008–0009. Spec: `docs/specs/2026-06-02-06c-emergency-call-design.md`, plan: `docs/plans/2026-06-02-06c-emergency-call.md` | `plan-06c-emergency-complete` |
| 7 | Owner portal *(reordered after kiosk — call views show AUDIO+VIDEO from day one)* — **split into 7a (read views) + 7b (self-service writes)** during 2026-06-02 brainstorm | — |
| **7a** | **Owner portal read views** — mobile-first shell (header + bottom tab bar) + Home glance cards (agent presence, today-count, open-incident badge) + property detail (read; routing DID hidden) + call history (filter + load-more) + call detail (+ dark recording seam) + incident list/detail (read). `lib/owner/` helpers TDD'd. `<AutoRefresh>` poller (router.refresh on 20s + focus). Zero migrations / new routes / service-role. Spec: `docs/specs/2026-06-02-07a-owner-portal-design.md` · Plan: `docs/plans/2026-06-02-07a-owner-portal.md` | `plan-07a-owner-portal-complete` |
| **7b** | **Owner self-service writes** — kiosk-content inline editing (8 fields, inline Edit/Save/Cancel card) + playbook upload/view (service-role route, versioned key, 1h signed URL) + incident resolve (optional note, final, column-guard trigger). Migration 0010: `incidents.resolution_note` column + owner UPDATE RLS on `properties`/`incidents` + two BEFORE UPDATE column-guard triggers (`updated_at` excluded from property guard). 231 tests passing. Spec: `docs/specs/2026-06-03-07b-owner-writes-design.md` · Plan: `docs/plans/2026-06-03-07b-owner-writes.md` | `plan-07b-owner-writes-complete` |
| **8** | **Observability** — Sentry (both apps, PII-scrubbed `beforeSend`) + `@vercel/analytics` + admin `/audit` viewer (filter + load-more, 2-query actor merge) + admin `/status` health page driven by a generic `health_signals` heartbeat registry (Twilio webhook + cron self-report) and live Supabase/Sentry probes. Migration 0011. 252 tests passing. Spec: `docs/specs/2026-06-03-08-observability-design.md` · Plan: `docs/plans/2026-06-03-08-observability.md` | `plan-08-observability-complete` |

**Key patterns established so far:**

- **Server Actions** live in `app/(admin)/admin/<section>/actions.ts` — thin wrappers around tested `lib/` helpers. Import `requireRole` first, validate, call helper, audit, `revalidatePath`.
- **`lib/users/` TDD pattern**: pure helpers (`validate.ts`, `guards.ts`, `invite.ts`) unit-tested with Vitest mocks before wiring into Server Actions.
- **Admin pages**: Server Component `page.tsx` fetches data (via user-scoped client), passes to a `"use client"` `*-table.tsx` that owns all dialogs/sheets.
- **Typed routes**: `typedRoutes: true` in `next.config.ts`. Use `href={href as never}` for routes not yet created (forward-references in nav items).
- **Self-edit guards**: `lib/users/guards.ts` — `assertNotSelfDemote`, `assertNotSelfDeactivate`, `assertNotSelfDelete`. Always call server-side in actions; mirror in UI (disable controls, hide menu items).
- **Hard delete**: always requires typed email confirm in the AlertDialog. Audit row written BEFORE the delete call.
- **Migrations**: `supabase/migrations/0003_audit_actor_set_null.sql` sets `audit_logs.actor_user_id` FK to ON DELETE SET NULL so hard-deletes don't fail on prior audit rows.
- **RLS cross-table checks**: a policy on table A that must check table B (and vice-versa) causes "infinite recursion detected in policy." Put the existence check in a `SECURITY DEFINER` SQL function with `set search_path = public` (like `current_user_operator_id()`) — it runs as the owner and does not re-enter B's RLS. See `0004_fix_rls_recursion.sql` (`user_owns_property`, `user_is_assigned_to_property`).
- **Temporal-row invariant (assignments)**: "active" = the row with `effective_until IS NULL`. The one-active-per-property rule is guarded by a partial unique index (`0005`, `property_assignments_one_active`), and the Server Action mutates with **close-then-insert** (stamp the prior row's `effective_until`, then insert the new one) so a mid-failure leaves the property unassigned (safe), never double-assigned. A concurrent double-assign hits the index → caught as `23505` → friendly retry message. Pure decision logic lives in `lib/assignments/plan.ts` (`planAssignmentChange`).
- **Optimistic boolean toggle**: roll back to `!next` (not a closed-over `prev`) so a rapid double-toggle can't restore a stale value. See `availability-cards.tsx`.
- **RSC client boundary (Next 15.5)**: passing a non-serializable prop — a function, or a lucide icon *component* — from a Server Component to a Client Component is now a fatal 500 ("Functions cannot be passed directly to Client Components"). It was silently tolerated in 15.1.x. A component that hands icon components to a client child must itself be `"use client"`, or pass an already-rendered `<Icon />` element instead of the component.

## Reading order at session start

1. This file (CLAUDE.md)
2. `MEMORY.md` → `project-status.md` for current plan and next steps
3. The relevant plan in `docs/plans/` for the task at hand
