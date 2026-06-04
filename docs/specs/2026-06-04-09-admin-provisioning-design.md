# Plan 9 — Email-free admin provisioning + forced password change + specific sign-in errors

**Status:** design approved 2026-06-04, awaiting spec review → implementation plan
**Author:** Kumar + Claude (brainstormed 2026-06-04)

## Why

The pilot launch is blocked on auth. Supabase email links (invite, password
recovery) return the session in the URL fragment and are sent through a
rate-limited "testing only" mailer; customizing the templates is now gated behind
custom SMTP. The code fix for the fragment problem shipped (`/auth/confirm` via
`verifyOtp`, commit `24fd100`), but going live still depends on SMTP + a verified
domain — neither of which exists yet.

Rather than block the pilot on SMTP, we make provisioning **email-free**: an admin
creates a user with a temporary password, the user is forced to set their own
password at first sign-in, and the admin can reset the same way. This keeps the
locked **password-only** model, keeps **invite-only** (the admin still controls who
exists), needs **zero email**, and reuses the existing `/onboarding` page. The email
invite/reset paths are left dormant and documented for re-enabling once SMTP lands.

Two adjacent asks are folded in: **specific sign-in error states** (not the generic
"invalid email or password" for every case) and a **"show password"** toggle on all
password fields.

While mapping the auth surface we found a latent **privilege-escalation hole** in the
`profiles` RLS (below). It is closed here because the new flag's tamper-proofing
depends on the same fix.

## Scope

**In:** admin-provisioned users with a typed temp password; a forced-password-change
gate; admin password reset; specific sign-in errors; a reusable show-password input;
an RLS column-guard on `profiles`; recovery of the two broken prod test users.

**Out (YAGNI):** password complexity rules (length-only, ≥ 8), system-generated /
reveal-once temp passwords, MFA, magic link, Google/Apple/SAML SSO, custom SMTP.

## Locked-decision update

The CLAUDE.md auth decision currently reads "Supabase Auth, password only,
invite-only." "Invite-only" is refined to **"admin-provisioned"**: users are created
by an admin with a temporary password rather than via an email invite. Password-only,
RLS-on-every-table, and the middleware gate are unchanged. This is recorded as an ADR
on implementation.

## Security finding (closed here): broad `profiles` self-update

`supabase/migrations/0002_rls.sql` defines:

```sql
create policy "profiles_update_self" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
```

Postgres RLS is row-level only, and `authenticated` holds default column-UPDATE
grants, so any signed-in user can `PATCH` their own profile row and change **any**
column — including `role` and `active`. A user could self-promote to `ADMIN` or
re-activate a deactivated account via the REST API (no app UI exists, but the API
permits it). Column-level `GRANT`s can't fix this because admins and users share the
`authenticated` role.

**Fix (migration 0012):** a `BEFORE UPDATE` column-guard trigger — the same pattern as
`0010`'s `enforce_owner_*_columns` — that differentiates by `current_user_role()` at
runtime. This both closes the escalation hole and makes `must_change_password`
tamper-proof.

## Architecture

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `supabase/migrations/0012_admin_provisioning.sql` | Add `profiles.must_change_password`; add `enforce_profile_self_columns()` trigger | profiles, `current_user_role()` |
| `lib/users/provision.ts` (`provisionUser`) | Create a confirmed auth user with a temp password + insert profile (`must_change_password: true`); roll back auth user on profile-insert failure | service-role client |
| `lib/users/validate.ts` (`validatePassword`, `validateTempPassword`) | Length-only password validation (≥ 8), shared by all password entry points | — |
| `lib/auth/sign-in-errors.ts` (`mapSignInError`) | Pure GoTrue-error → user-message mapping | — |
| `components/ui/password-input.tsx` (`PasswordInput`) | shadcn `Input` + show/hide toggle | lucide-react |
| `requireRole` (edit) | Existing role gate also forces `/onboarding` when `must_change_password` | profiles |
| Onboarding action (edit) | Set password, clear flag via admin client, audit | service-role client |
| Admin users actions (edit) | `createUserAction`, `resetPasswordAction`; audit `user.created` / `user.password_reset_by_admin` | provisionUser, service-role client |
| Sign-in action (edit) | Map errors; block deactivated users post-auth | mapSignInError, profiles |

### Data model — migration `0012`

```sql
alter table profiles
  add column must_change_password boolean not null default false;
```

`default false` is deliberate: existing and seed users are never accidentally forced
into onboarding. Update `packages/shared/src/supabase-types.ts` (profiles
Row/Insert/Update).

Column-guard trigger:

```sql
create or replace function enforce_profile_self_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only guard genuine self-updates by a non-admin. Service-role / admin writes
  -- have a null auth.uid() and skip the guard (onboarding clears the flag, admin
  -- actions change role/active legitimately).
  if auth.uid() = new.id and coalesce(current_user_role(), '') <> 'ADMIN' then
    if new.role            is distinct from old.role
       or new.active       is distinct from old.active
       or new.operator_id  is distinct from old.operator_id
       or new.must_change_password is distinct from old.must_change_password
       or new.email        is distinct from old.email
       or new.twilio_identity is distinct from old.twilio_identity
       or new.created_at    is distinct from old.created_at then
      raise exception 'profiles: only full_name is self-editable';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_enforce_self_columns
  before update on profiles
  for each row execute function enforce_profile_self_columns();
```

### Provisioning flow (create user)

1. Admin opens "Add user", enters email, full name, role, and a **temporary
   password** (required, validated ≥ 8 client- and server-side so GoTrue never
   rejects a value the UI accepted).
2. `createUserAction` (renamed from `inviteUserAction`) → `provisionUser`:
   `admin.auth.admin.createUser({ email, password, email_confirm: true,
   user_metadata: { full_name, role } })` → insert profile with
   `must_change_password: true` (twilio_identity, `status: 'OFFLINE'`,
   `active: true` as today). On profile-insert failure, delete the auth user
   (existing rollback).
3. Audit `user.created`. Toast: "User created. Share their temporary password —
   they'll set their own at first sign-in."

`email_confirm: true` means the user is immediately confirmed — **no email is sent**.

### Forced-change gate + onboarding

- `requireRole` adds `must_change_password` to its existing profile `select`; when
  `true`, `redirect("/onboarding")`. Every role layout already calls `requireRole`,
  so it is the single chokepoint. `/onboarding` lives outside the role groups (the
  `(auth)` group) and is excluded from the middleware matcher, so there is no
  redirect loop.
- `/onboarding` already collects **name + password**. On submit:
  `updateUser({ password })` (validated) → clear the flag via the admin client
  (`profiles.update({ must_change_password: false })`, which the guard permits because
  it is a service-role write) → audit `user.onboarded` → redirect `/`.
- A reset user re-enters onboarding and re-confirms their name; acceptable for v1.

### Sign-in error handling

`lib/auth/sign-in-errors.ts`:

```ts
export function mapSignInError(e: { code?: string; status?: number }): string {
  if (e.status === 429 || e.code === "over_request_rate_limit")
    return "Too many attempts. Please wait a few minutes and try again.";
  if (e.code === "email_not_confirmed")
    return "Your account isn't fully set up yet. Please contact your administrator.";
  if (e.code === "invalid_credentials")
    return "Invalid email or password.";
  return "Something went wrong. Please try again."; // unexpected / unknown
}
```

`signInAction`:

1. Empty-field check (exists).
2. `signInWithPassword`. On error → `mapSignInError`.
3. On success → fetch `profiles.active`. If `false` → `signOut()` and return
   "This account has been deactivated. Please contact your administrator."
   (closes the silent bounce where a deactivated user signs in, then `requireRole`
   redirects them to `/sign-in` with no message).
4. Audit sign-in; redirect `/` (the `requireRole` gate then handles
   force-onboarding if needed).

**Enumeration note:** GoTrue intentionally returns the same `invalid_credentials`
for "no such email" and "wrong password," so we keep those combined. See Forward-compat.

### Admin reset + broken-user recovery

- Users-table row action **"Reset password"** → dialog with a new temp password
  (≥ 8) → `resetPasswordAction`:
  `admin.auth.admin.updateUserById(id, { password })` →
  `profiles.update({ must_change_password: true })` → audit
  `user.password_reset_by_admin`.
- This recovers the two broken prod users (`bovarovadilnoza0@gmail.com`,
  `kumar@unbrandt.com`): admin-reset → temp password → forced onboarding. No
  delete/recreate needed.

### Forgot-password + dormant email seam

- Sign-in "Forgot password?" link → static text: "Forgot your password? Contact your
  administrator."
- `/forgot-password`, `/auth/update-password`, `/auth/confirm`, `/auth/callback`
  stay in the codebase but unlinked = dormant. The email-invite path is removed from
  provisioning; `/auth/confirm` + `docs/setup/2026-06-04-auth-email-templates.md`
  remain as the documented re-enable seam.

### Password rule conveyance

- Length-only (≥ 8), no complexity. Unify on `validatePassword` across onboarding,
  the temp-password fields, and the dormant update-password action (which currently
  has its own inline length check).
- Onboarding form: helper line "Must be at least 8 characters" + specific errors
  ("Password must be at least 8 characters." / "Passwords do not match.").
- Dashboard: set GoTrue **Minimum password length = 8** so the server agrees with the
  UI.

### Show-password toggle

`components/ui/password-input.tsx` wraps the shadcn `Input` with a trailing
eye / eye-off button (lucide `Eye`/`EyeOff`) toggling `type` between `password` and
`text`. Default hidden; `aria-label` + `aria-pressed`; keyboard-reachable; preserves
`autoComplete`. Applied to: sign-in, onboarding (new + confirm, each its own toggle),
the create-user temp-password field, the reset-password field, and the dormant
update-password page.

### Admin UI badge

Users table shows a "Pending setup" badge when `must_change_password` is true — an
at-a-glance "has this person logged in and set their password yet?"

## Audit catalog

Add `user.created` and `user.password_reset_by_admin` to the hardcoded action list in
`app/(admin)/admin/audit/page.tsx`. Keep `user.invited` (historical rows) and
`user.onboarded`.

## Testing

- `lib/users/provision.ts` — unit tests: success, existing-email rejection,
  insert-rollback deletes the auth user.
- `lib/auth/sign-in-errors.ts` — pure mapping tests (429, `email_not_confirmed`,
  default).
- `validatePassword` / temp-password — boundary tests (length 7 fails, 8 passes).
- Migration `0012` column-guard — scripted RLS check during implementation: a
  non-admin self-update of `role` / `must_change_password` is rejected; a `full_name`
  self-update succeeds; an admin update of `role` succeeds.
- Replace the existing `inviteUser` tests.
- Full suite + typecheck + lint green before tag.

## Forward-compat seams (explicit)

- **Re-enable email invites / self-service reset** when SMTP + a domain land:
  `/auth/confirm` + the email-templates doc are the entry points.
- **Email/password-specific sign-in messages:** add a profile-existence pre-check in
  `signInAction` and extend `mapSignInError` to return distinct "no account" vs
  "incorrect password" — no form or layout changes. (Accepts the enumeration
  trade-off; fine for an invite-only internal tool.)
- **Google OAuth** later as a separate effort (sidesteps email entirely but departs
  from password-only and needs a sign-in gate to invited emails).

## Migration / rollout notes

- Migration `0012` is additive and safe on existing data (`default false`).
- Seed users (`localdev123`) keep `must_change_password = false` and skip onboarding.
- After deploy: set GoTrue Minimum password length = 8; admin-reset the two broken
  prod users to bring them through the fixed flow; then run the smoke test.
