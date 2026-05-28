# Plan 4a — Admin Layout + Users CRUD + Invite/Onboarding Design

**Status**: Approved 2026-05-28
**Authors**: Kumar Thakkar + Claude
**Parent spec**: `docs/specs/2026-05-27-v1-architecture-design.md` (sections 5, 6.1, 6.2, 9)
**Predecessor**: Plan 3 (Auth & role routing) — tag `plan-03-auth-routing-complete`

---

## 1. Purpose

Stand up the admin portal shell, the user-management table, the invite flow (Supabase invite + `profiles` row pre-creation), and the `/onboarding` page where invited users set their password and confirm their name. Every meaningful mutation writes an audit row.

This is the first of three sibling plans (4a / 4b / 4c) that decompose the "Admin CRUD" milestone called out in the architecture spec. Plan 4a covers the auth-adjacent half (layout + users + invite + onboarding). Plan 4b adds properties CRUD. Plan 4c adds property assignments and `admin_call_availability`.

---

## 2. Scope

**In:**
- `supabase/migrations/0003_audit_actor_set_null.sql` — change `audit_logs.actor_user_id` FK to `ON DELETE SET NULL`
- `apps/portal/middleware.ts` matcher fix — exclude `/forgot-password` (live bug from Plan 3) and `/onboarding`
- Admin layout shell: collapsed icon-sidebar with hover-expand, logo = home, header with profile menu + sign-out
- `/admin` overview stub under the new shell
- `/admin/users` page — table with invite, edit, deactivate, and hard-delete actions
- `/onboarding` page + Server Action — invited user sets password and confirms `full_name`
- shadcn install: `sidebar`, `dropdown-menu`, `dialog`, `sheet`, `alert-dialog`, `table`, `badge`, `select`, `switch`, `sonner`
- TDD coverage on the testable libs: validators, self-edit guard, invite-with-rollback

**Out (deferred to 4b / 4c / later plans):**
- Properties CRUD — 4b
- Property assignments — 4c
- `admin_call_availability` toggle — 4c
- `/audit` viewer page — Plan 8 (this plan only *writes* audit rows)
- `/status` page — Plan 8
- Settings page (sidebar nav slot reserved, no page built)
- Twilio identity rotation on role change (regenerate when AGENT → OWNER)

---

## 3. Locked Decisions

### 3.1 Scope split into 4a / 4b / 4c

Admin CRUD as originally scoped is ~20 tasks across four entity types plus an invite flow. Decomposing into three plans keeps each one in the ~13-task envelope that Plan 3 demonstrated is comfortable. Boundaries:

- **4a** (this plan) — layout shell, users CRUD, invite, onboarding
- **4b** — properties CRUD (reuses the shell)
- **4c** — property assignments + `admin_call_availability` (reuses the shell, depends on both users and properties existing)

Each sibling plan ends with its own tag (`plan-04a-…`, `plan-04b-…`, `plan-04c-…`).

### 3.2 Full layout shell built in 4a

Even though 4a only has two real pages (`/admin` overview + `/admin/users`), the sidebar lists Users / Properties / Assignments / Settings up front. Properties and Assignments link to routes that 404 until 4b / 4c land — intentional, and they light up as soon as those plans ship without a sidebar revision.

Shell pieces:
- shadcn `Sidebar` with `collapsible="icon"`, hover-expand (per architecture spec §9.3)
- Logo at top, links to `/admin` (admin home)
- Nav items (lucide icons): `Users`, `Building2` (Properties), `UsersRound` (Assignments), `Settings`
- Right-aligned header with `DropdownMenu`: user name + role badge + Sign out (POSTs to existing `/auth/signout`)

### 3.3 Block self-demote and self-deactivate

Server-side: if `actor_user_id === target_user_id` and the patch contains a role change or `active: false`, return a typed error. UI mirrors this — Edit Sheet shows role and active fields disabled for the current admin's own row, and Deactivate / Delete Permanently are hidden from that row's `…` menu. `full_name` is still editable on self.

No "last admin in operator" count check in v1 — the simpler self-guard is enough since invites and operator setup are admin-controlled.

### 3.4 Soft-delete primary, hard-delete escape hatch

Default deletion is `active = false` — keep `auth.users` and audit history intact. Inactive users can't sign in (middleware + `requireRole` both check `active`).

Hard delete is available behind a destructive confirm: the admin must type the target's email to enable the destructive button. The action calls `auth.admin.deleteUser(targetUserId)` via the service role, which cascades to `profiles` (already `on delete cascade`).

Hard delete is the reason for migration 0003 — see §3.5.

### 3.5 `audit_logs.actor_user_id` becomes `ON DELETE SET NULL`

Plan 2 left `audit_logs.actor_user_id` as a plain FK to `profiles(id)` without an `ON DELETE` clause, which defaults to `NO ACTION`. A hard-delete on any user with prior audit rows would fail with a FK violation.

Migration `0003_audit_actor_set_null.sql` drops the FK and recreates it with `ON DELETE SET NULL`. Post-delete, the audit row still says "someone did X" — the actor's id is gone, but the action and entity stay. That's the correct audit posture: deletion of the actor doesn't rewrite the history of what they did.

### 3.6 Pre-create profile at invite time

Per architecture spec §6.1: "API route uses Supabase service role to create both `auth.users` row and `profiles` row in a single transaction."

Mechanically, this is two API calls (not a single SQL transaction), so the implementation is:

1. `auth.admin.inviteUserByEmail(email, { data: { full_name, role }, redirectTo: '<APP_URL>/auth/callback?next=/onboarding' })`
2. Capture `newUser.id`. `INSERT INTO profiles (id, operator_id, role, full_name, email, twilio_identity, status, active)`
3. If step 2 fails, call `auth.admin.deleteUser(newUser.id)` to roll back. Don't leave orphan auth users.

The TDD test for `lib/users/invite.ts` proves the rollback path runs when profile insert fails.

### 3.7 Onboarding collects password + editable full_name

After clicking the invite email link, the user lands at `/onboarding` with a real session (PKCE exchange happened at `/auth/callback`). The page shows:
- `new password` (min 8 chars)
- `confirm password`
- `full name` (pre-filled from `profiles.full_name`, editable)

Submit → `supabase.auth.updateUser({ password })`, optionally `update profiles set full_name = ...` if the value changed, audit row `user.onboarded` with `details: { name_changed: bool }`, redirect to `/` which routes to the user's role dashboard.

The user can correct typos the admin made when inviting them. They cannot change their email — that requires Supabase's email-change-confirmation flow, deferred indefinitely.

### 3.8 Invite form collects email + full_name + role only

No property-assignment picker at invite time, no owner-property picker. Those are 4c concerns. Coupling them to the invite form would force 4c work into 4a.

`twilio_identity` is auto-generated server-side as `user-${newUser.id.slice(0,8)}` for ADMIN and AGENT roles. OWNER gets `null` (owners don't have a softphone). This matches the schema CHECK that allows but doesn't require `twilio_identity`.

### 3.9 Middleware matcher fix

Plan 3's matcher excludes `/sign-in` and `/auth/*` but not `/forgot-password`. An unauthed user clicking "Forgot password?" today is redirected back to `/sign-in` by the middleware — the page is unreachable for its intended audience.

This plan's Task 1 extends the matcher to also exclude `forgot-password` and `onboarding`. The new regex:

```
/((?!_next/static|_next/image|favicon.ico|api/|sign-in|forgot-password|onboarding|auth/).*)
```

`/onboarding` in practice always has a session when visited (PKCE landing), so the middleware wouldn't redirect anyway — but adding it to the exclusion is cleaner than relying on the session check.

---

## 4. File Layout

```
supabase/migrations/
└── 0003_audit_actor_set_null.sql            ← NEW

apps/portal/
├── middleware.ts                            ← MODIFIED: matcher
├── app/
│   ├── (auth)/
│   │   └── onboarding/
│   │       ├── page.tsx                     ← NEW
│   │       └── actions.ts                   ← NEW
│   └── (admin)/
│       ├── layout.tsx                       ← MODIFIED: render shell instead of <>{children}</>
│       └── admin/
│           ├── page.tsx                     ← MODIFIED: overview stub under shell
│           └── users/
│               ├── page.tsx                 ← NEW: Server Component, fetches profiles
│               ├── users-table.tsx          ← NEW: Client Component (table + dialogs)
│               └── actions.ts               ← NEW: invite/update/delete Server Actions
├── components/
│   ├── app-sidebar.tsx                      ← NEW
│   ├── user-menu.tsx                        ← NEW
│   └── nav-item.tsx                         ← NEW
├── lib/
│   └── users/
│       ├── invite.ts                        ← NEW: core invite logic (testable)
│       ├── validate.ts                      ← NEW: shared input validators
│       └── guards.ts                        ← NEW: self-edit guard helpers
└── tests/
    └── lib/users/
        ├── invite.test.ts                   ← NEW (TDD)
        ├── validate.test.ts                 ← NEW (TDD)
        └── guards.test.ts                   ← NEW (TDD)
```

No `apps/kiosk/` or `packages/shared/` changes in this plan.

---

## 5. Server Action Surface

All three actions live in `app/(admin)/admin/users/actions.ts`. Each starts by calling a `requireRole("ADMIN")`-style helper to get the actor profile, applies the relevant guard, performs the mutation, writes the audit row, and `revalidatePath('/admin/users')`.

| Action | Inputs | Audit `action` | Notes |
|---|---|---|---|
| `inviteUserAction` | `email`, `full_name`, `role` | `user.invited` | Pre-creates profile; rolls back auth user on profile insert failure |
| `updateUserAction` | `targetUserId`, optional `full_name`, `role`, `active` | One audit row per changed field: `user.role_changed`, `user.active_toggled`, `user.profile_edited` | Self-edit guard blocks role + active changes when actor == target. If new role is AGENT or ADMIN and `twilio_identity is null` (was OWNER), assign `user-${id.slice(0,8)}` as part of the same update. |
| `hardDeleteUserAction` | `targetUserId`, `confirmEmail` | `user.deleted` | `confirmEmail` must match the target's email exactly; otherwise rejects |

The `/onboarding` action lives separately at `app/(auth)/onboarding/actions.ts` and writes `user.onboarded`.

---

## 6. RLS Considerations

The new code reads `profiles` and writes via service role:

- `/admin/users` Server Component reads `profiles` with the user-scoped server client. RLS already allows admins to see all profiles in their operator (per Plan 2 / arch spec §6.2). No new policy needed.
- `inviteUserAction`, `updateUserAction`, `hardDeleteUserAction`, `onboardingAction` (for the `update profiles set full_name` branch) all use the service-role admin client. They bypass RLS by design — server-side authorization is enforced via `requireRole` + guards, not via RLS on these paths.
- `audit_logs` writes continue to go through the existing `logAuditEvent` helper from Plan 3 (service role).

---

## 7. Testing Strategy

**TDD on:**
- `lib/users/validate.ts` — email regex, role enum membership, name length bounds. Pure functions.
- `lib/users/guards.ts` — `assertNotSelfDemote(actor, patch)` and `assertNotSelfDeactivate(actor, patch)`. Pure functions.
- `lib/users/invite.ts` — mock the admin Supabase client; verify (a) happy path inserts profile after invite, (b) rollback path calls `deleteUser` when profile insert fails, (c) duplicate-email pre-check rejects before calling Supabase.

**Skipped:**
- React component tests — no component test infra in this project; visual smoke covers it.
- Server Action end-to-end tests — thin glue over the tested `lib/users/*` functions.
- Audit logger — already covered in Plan 3.

**Manual smoke (Plan 4a Task 13):**
1. Sign in as seeded admin → sidebar → `/admin/users` → see seeded admin row.
2. Invite a user (Inbucket at `localhost:54324` catches the email). Confirm `auth.users` + `profiles` + audit `user.invited`.
3. Click the invite link → land on `/onboarding` → set password + tweak name → land on role dashboard. Confirm audit `user.onboarded`.
4. As admin, change the new user's role (audit `user.role_changed`), then deactivate (audit `user.active_toggled`).
5. Try to deactivate self — UI hides the action, action rejects if called directly.
6. Hard-delete a user: type their email to enable the button, confirm. `auth.users` gone, old audit rows show `actor_user_id = null` (proves migration 0003 worked).
7. `/forgot-password` reachable while signed out (proves middleware matcher fix).
8. Sign out from header menu → land on `/sign-in`.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Supabase invite + profile insert leaves orphan auth user when profile insert fails | TDD-covered rollback in `lib/users/invite.ts` calls `auth.admin.deleteUser` on failure |
| Admin locks themselves out via UI bug | Server-side self-edit guard rejects role + active mutations when `actor.id === target.id` regardless of what the UI sends |
| Hard delete fails due to audit FK | Migration 0003 changes the FK to `ON DELETE SET NULL` |
| `/onboarding` reachable from middleware blocks user with valid recovery session | `/onboarding` has a session at landing; matcher exclusion is belt-and-suspenders |
| Email change at onboarding diverges from Supabase auth identity | Email is read-only on onboarding form; only password + full_name editable |
| shadcn install pulls newer Tailwind / token defaults that drift from existing CSS | Install component-by-component; visually verify the sign-in page (only existing UI) still renders correctly before moving on |
| Sidebar Nav items pointing at unimplemented routes (Properties, Assignments) confuse smoke testers | Acceptable v1 cost; routes return Next.js default 404, plans 4b / 4c flip them on |

---

## 9. Non-Goals

- No properties, assignments, availability toggle, or settings page in this plan
- No `/audit` viewer (Plan 8)
- No password strength meter or 2FA enrollment on `/onboarding`
- No bulk user import
- No email change flow for existing users
- No last-active-admin guard — only the simpler self-edit guard

---

## 10. Definition of Done

- Migration 0003 applied locally; `audit_logs.actor_user_id` FK is `ON DELETE SET NULL`
- `/forgot-password` reachable without a session (manual smoke)
- Admin shell renders with sidebar + header on every `/admin/*` route
- `/admin/users` shows the seeded admin + supports invite, edit, deactivate, hard-delete
- `/onboarding` accepts password + full_name, writes `user.onboarded` audit row
- All TDD tests pass (`pnpm test` clean)
- `pnpm typecheck` + `pnpm lint` clean
- Tag `plan-04a-admin-users-complete` pushed to `main`

---

*End of Plan 4a design.*
