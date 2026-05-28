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
| **4b** | **Properties CRUD** | next up |
| 4c | Assignments + `admin_call_availability` | — |
| 5 | Voice path + agent dashboard | — |
| 6 | Owner portal | — |
| 7 | Kiosk | — |
| 8 | Observability | — |

**Key patterns established so far:**

- **Server Actions** live in `app/(admin)/admin/<section>/actions.ts` — thin wrappers around tested `lib/` helpers. Import `requireRole` first, validate, call helper, audit, `revalidatePath`.
- **`lib/users/` TDD pattern**: pure helpers (`validate.ts`, `guards.ts`, `invite.ts`) unit-tested with Vitest mocks before wiring into Server Actions.
- **Admin pages**: Server Component `page.tsx` fetches data (via user-scoped client), passes to a `"use client"` `*-table.tsx` that owns all dialogs/sheets.
- **Typed routes**: `typedRoutes: true` in `next.config.ts`. Use `href={href as never}` for routes not yet created (forward-references in nav items).
- **Self-edit guards**: `lib/users/guards.ts` — `assertNotSelfDemote`, `assertNotSelfDeactivate`, `assertNotSelfDelete`. Always call server-side in actions; mirror in UI (disable controls, hide menu items).
- **Hard delete**: always requires typed email confirm in the AlertDialog. Audit row written BEFORE the delete call.
- **Migrations**: `supabase/migrations/0003_audit_actor_set_null.sql` sets `audit_logs.actor_user_id` FK to ON DELETE SET NULL so hard-deletes don't fail on prior audit rows.

## Reading order at session start

1. This file (CLAUDE.md)
2. `MEMORY.md` → `project-status.md` for current plan and next steps
3. The relevant plan in `docs/plans/` for the task at hand
