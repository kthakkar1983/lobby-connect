# Email-free Admin Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision users with an admin-typed temporary password (no email/SMTP), force a password change at first sign-in, allow admin-driven resets, and show specific sign-in error states — plus a reusable show-password toggle and an RLS column-guard that closes a self-update escalation hole.

**Architecture:** A `profiles.must_change_password` flag (set on admin create/reset, cleared on onboarding) gates users into `/onboarding` via the existing `requireRole`. A `BEFORE UPDATE` column-guard trigger makes the flag (and `role`/`active`) tamper-proof. Provisioning swaps `inviteUserByEmail` for `admin.createUser({ email_confirm: true })`. Sign-in errors route through a pure mapper; deactivated users are blocked post-auth. Email invite/reset paths go dormant.

**Tech Stack:** Next.js App Router (Server Actions + RSC), Supabase (Postgres + Auth, service-role admin client), `@supabase/supabase-js ^2.45`, shadcn/ui, lucide-react, Vitest. Monorepo (pnpm) — portal at `apps/portal`.

**Spec:** `docs/specs/2026-06-04-09-admin-provisioning-design.md`

**Conventions:**
- Run commands from `apps/portal/` unless noted. Tests: `pnpm test` (= `vitest run`). Typecheck: `pnpm typecheck`. Lint from repo root: `pnpm lint`.
- Local Supabase: `supabase db reset` re-applies all migrations + seed. Single migration apply: `supabase migration up` (or paste into Studio SQL editor).
- The service-role client is `createAdminClient()` (`@/lib/supabase/admin`); the user-scoped SSR client is `createServerClient()` (`@/lib/supabase/server`).
- No emojis in code/commits. Commit messages end with the Co-Authored-By trailer used in repo history.

---

## File Structure

**Create:**
- `supabase/migrations/0012_admin_provisioning.sql` — flag column + column-guard trigger
- `apps/portal/lib/users/provision.ts` — `provisionUser` (replaces `invite.ts`)
- `apps/portal/lib/auth/sign-in-errors.ts` — `mapSignInError` pure mapper
- `apps/portal/components/ui/password-input.tsx` — show/hide password field
- `apps/portal/tests/lib/users/provision.test.ts` — provisionUser tests (replaces `invite.test.ts`)
- `apps/portal/tests/lib/auth/sign-in-errors.test.ts` — mapper tests

**Modify:**
- `packages/shared/src/supabase-types.ts` — add `must_change_password` to profiles Row/Insert/Update
- `apps/portal/lib/auth/require-role.ts` — force `/onboarding` when flag set
- `apps/portal/app/(admin)/admin/users/actions.ts` — `createUserAction` + `resetPasswordAction`
- `apps/portal/app/(admin)/admin/users/users-table.tsx` — temp-password field, reset dialog, pending badge
- `apps/portal/app/(admin)/admin/users/page.tsx` — select `must_change_password`
- `apps/portal/app/(admin)/admin/audit/page.tsx` — add 2 actions to `KNOWN_ACTIONS`
- `apps/portal/app/(auth)/onboarding/actions.ts` — clear flag via admin client
- `apps/portal/app/(auth)/onboarding/onboarding-form.tsx` — helper text + `PasswordInput`
- `apps/portal/app/(auth)/sign-in/actions.ts` — map errors + block deactivated
- `apps/portal/app/(auth)/sign-in/page.tsx` — `PasswordInput` + forgot-link copy
- `apps/portal/app/auth/update-password/page.tsx` + `actions.ts` — `PasswordInput` + reuse `validatePassword`

**Delete:**
- `apps/portal/lib/users/invite.ts` and `apps/portal/tests/lib/users/invite.test.ts` (replaced by `provision.*`)

---

## Task 1: Migration 0012 — flag column + column-guard trigger

**Files:**
- Create: `supabase/migrations/0012_admin_provisioning.sql`
- Modify: `packages/shared/src/supabase-types.ts` (profiles Row ~line 67, Insert ~line 81, Update ~line 95)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_admin_provisioning.sql`:

```sql
-- 0012_admin_provisioning.sql — Plan 9 (email-free admin provisioning).
-- 1. must_change_password flag: set true on admin create/reset, cleared on
--    onboarding. default false so existing + seed users are never force-onboarded.
-- 2. profiles self-update column guard. profiles_update_self (0002) is row-level
--    only, so a non-admin could PATCH their own role/active/etc. This guard (same
--    pattern as 0010's enforce_owner_* triggers) restricts a non-admin self-update
--    to full_name only — closing a privilege-escalation hole AND tamper-proofing
--    the new flag. Service-role/admin writes have auth.uid()=NULL (or role ADMIN)
--    and skip the guard, so onboarding + admin actions still work. Idempotent.

alter table profiles
  add column if not exists must_change_password boolean not null default false;

create or replace function enforce_profile_self_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Guard only a genuine non-admin self-update. updated_at is excluded because
  -- profiles_set_updated_at (a BEFORE UPDATE trigger) stamps it on every update.
  if auth.uid() = new.id and coalesce(current_user_role(), '') <> 'ADMIN' then
    if (to_jsonb(old) - array['full_name','updated_at']::text[])
       is distinct from
       (to_jsonb(new) - array['full_name','updated_at']::text[])
    then
      raise exception 'profiles: only full_name is self-editable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_profile_self_columns on profiles;
create trigger trg_enforce_profile_self_columns
  before update on profiles
  for each row execute function enforce_profile_self_columns();
```

- [ ] **Step 2: Apply the migration locally**

Run (from repo root): `supabase migration up`
Expected: applies `0012` with no error. (If using Studio, paste the file into the SQL editor and run.)

- [ ] **Step 3: Verify the guard manually**

Confirm the trigger is wired and the function exists. Run:
`supabase db psql -c "select tgname from pg_trigger where tgname = 'trg_enforce_profile_self_columns';"`
Expected: one row. (Full RLS behavior — a non-admin self-promote being rejected — is verified end-to-end in Task 10's smoke notes; there is no SQL unit-test harness in this repo.)

- [ ] **Step 4: Add the column to generated types**

In `packages/shared/src/supabase-types.ts`, add `must_change_password` to the profiles type in all three shapes:
- Row (after `active: boolean;` ~line 75): `          must_change_password: boolean;`
- Insert (after `active?: boolean;` ~line 89): `          must_change_password?: boolean;`
- Update (after `active?: boolean;` ~line 103): `          must_change_password?: boolean;`

- [ ] **Step 5: Typecheck**

Run (from `apps/portal`): `pnpm typecheck`
Expected: PASS (no usages yet, but the shared types compile).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_admin_provisioning.sql packages/shared/src/supabase-types.ts
git commit -m "$(cat <<'EOF'
feat(09): migration 0012 - must_change_password + profiles self-update guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `provisionUser` helper (replaces `inviteUser`)

**Files:**
- Create: `apps/portal/lib/users/provision.ts`
- Create: `apps/portal/tests/lib/users/provision.test.ts`
- Delete: `apps/portal/lib/users/invite.ts`, `apps/portal/tests/lib/users/invite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/users/provision.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

function buildAdminMock(opts: {
  existingProfile?: { id: string } | null;
  createResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingProfile ?? null,
    error: null,
  });
  const insert = vi.fn().mockResolvedValue(opts.insertResult ?? { error: null });
  const eqEmail = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqEmail }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select, insert };
    throw new Error(`unexpected table ${table}`);
  });

  const createUser = vi.fn().mockResolvedValue(
    opts.createResult ?? { data: { user: { id: "user-new" } }, error: null },
  );
  const deleteUser = vi.fn().mockResolvedValue({ error: null });

  return {
    from,
    auth: { admin: { createUser, deleteUser } },
    _spies: { createUser, insert, deleteUser, maybeSingle },
  };
}
type Admin = ReturnType<typeof buildAdminMock>;

afterEach(() => vi.clearAllMocks());

describe("provisionUser", () => {
  it("rejects an email that already has a profile", async () => {
    const admin = buildAdminMock({ existingProfile: { id: "u-existing" } }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "x@example.com", full_name: "X", role: "AGENT", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: false, error: "A user with this email already exists." });
    expect(admin._spies.createUser).not.toHaveBeenCalled();
  });

  it("creates a confirmed user + profile with must_change_password true (AGENT gets twilio_identity)", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada Lovelace", role: "AGENT", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: true, userId: "user-new" });
    expect(admin._spies.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        password: "temp1234",
        email_confirm: true,
        user_metadata: { full_name: "Ada Lovelace", role: "AGENT" },
      }),
    );
    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-new",
        operator_id: "op-1",
        role: "AGENT",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        twilio_identity: "lc_usernew",
        must_change_password: true,
        active: true,
      }),
    );
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });

  it("creates OWNER with twilio_identity null", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "o@example.com", full_name: "Olive", role: "OWNER", tempPassword: "temp1234" },
    });
    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "OWNER", twilio_identity: null }),
    );
  });

  it("rolls back the auth user when profile insert fails", async () => {
    const admin = buildAdminMock({ insertResult: { error: { message: "dup twilio_identity" } } }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada", role: "ADMIN", tempPassword: "temp1234" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to create profile/);
    expect(admin._spies.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("returns the Supabase error when createUser fails", async () => {
    const admin = buildAdminMock({
      createResult: { data: { user: null }, error: { message: "weak password" } },
    }) as Admin;
    const { provisionUser } = await import("@/lib/users/provision");
    const result = await provisionUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "ada@example.com", full_name: "Ada", role: "ADMIN", tempPassword: "temp1234" },
    });
    expect(result).toEqual({ ok: false, error: "Failed to create user: weak password" });
    expect(admin._spies.insert).not.toHaveBeenCalled();
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- provision`
Expected: FAIL — cannot find module `@/lib/users/provision`.

- [ ] **Step 3: Write `provision.ts`**

Create `apps/portal/lib/users/provision.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role } from "@lc/shared";

import { identityForRole } from "@/lib/users/twilio-identity";

export type ProvisionInput = {
  email: string;
  full_name: string;
  role: Role;
  tempPassword: string;
};

export type ProvisionResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

type Args = {
  admin: SupabaseClient<Database>;
  operatorId: string;
  input: ProvisionInput;
};

export async function provisionUser(args: Args): Promise<ProvisionResult> {
  const email = args.input.email.trim().toLowerCase();

  // 1. Pre-check existing profile.
  const { data: existing } = await args.admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  // 2. Create a confirmed auth user with the admin-typed temp password.
  //    email_confirm: true => no email is sent; the user can sign in immediately.
  const { data: created, error: createError } =
    await args.admin.auth.admin.createUser({
      email,
      password: args.input.tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: args.input.full_name,
        role: args.input.role,
      },
    });

  if (createError || !created?.user) {
    const message = createError?.message ?? "unknown error";
    return { ok: false, error: `Failed to create user: ${message}` };
  }

  const newUserId = created.user.id;

  // 3. Insert profile. must_change_password forces onboarding at first sign-in.
  const { error: insertError } = await args.admin.from("profiles").insert({
    id: newUserId,
    operator_id: args.operatorId,
    role: args.input.role,
    full_name: args.input.full_name,
    email,
    twilio_identity: identityForRole(args.input.role, newUserId),
    status: "OFFLINE",
    active: true,
    must_change_password: true,
  });

  if (insertError) {
    // 4. Roll back the auth user so the admin can retry cleanly.
    await args.admin.auth.admin.deleteUser(newUserId);
    return { ok: false, error: `Failed to create profile: ${insertError.message}` };
  }

  return { ok: true, userId: newUserId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- provision`
Expected: PASS (5 tests).

- [ ] **Step 5: Delete the old invite module + test**

```bash
git rm apps/portal/lib/users/invite.ts apps/portal/tests/lib/users/invite.test.ts
```

(Callers are updated in Task 5; `inviteUser` has no other importers — confirm with `grep -rn "lib/users/invite" apps/portal`.)

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/users/provision.ts apps/portal/tests/lib/users/provision.test.ts
git commit -m "$(cat <<'EOF'
feat(09): provisionUser - email-free admin create via createUser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `mapSignInError` pure helper

**Files:**
- Create: `apps/portal/lib/auth/sign-in-errors.ts`
- Create: `apps/portal/tests/lib/auth/sign-in-errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/auth/sign-in-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapSignInError } from "@/lib/auth/sign-in-errors";

describe("mapSignInError", () => {
  it("maps a 429 status to a rate-limit message", () => {
    expect(mapSignInError({ status: 429 })).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  it("maps over_request_rate_limit code to the rate-limit message", () => {
    expect(mapSignInError({ code: "over_request_rate_limit" })).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  });

  it("maps email_not_confirmed to a setup message", () => {
    expect(mapSignInError({ code: "email_not_confirmed", status: 400 })).toBe(
      "Your account isn't fully set up yet. Please contact your administrator.",
    );
  });

  it("defaults invalid_credentials (and missing code) to the credentials message", () => {
    expect(mapSignInError({ code: "invalid_credentials", status: 400 })).toBe(
      "Invalid email or password.",
    );
    expect(mapSignInError({ status: 400 })).toBe("Invalid email or password.");
    expect(mapSignInError({})).toBe("Invalid email or password.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- sign-in-errors`
Expected: FAIL — cannot find module `@/lib/auth/sign-in-errors`.

- [ ] **Step 3: Write the helper**

Create `apps/portal/lib/auth/sign-in-errors.ts`:

```ts
// Maps a Supabase sign-in AuthError to a specific user-facing message.
// `error.code` is unreliable at @supabase/supabase-js ^2.45, so the rate-limit
// branch keys on status 429 and the default covers invalid_credentials whether
// or not `code` is present. The deactivated-account case is NOT here — it is a
// post-success profiles.active check in signInAction.
//
// Forward-compat (spec): to later split "no account" vs "wrong password", add a
// profile-existence pre-check in signInAction and extend this mapper — no UI
// changes required.
export function mapSignInError(e: { code?: string; status?: number }): string {
  if (e.status === 429 || e.code === "over_request_rate_limit") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (e.code === "email_not_confirmed") {
    return "Your account isn't fully set up yet. Please contact your administrator.";
  }
  return "Invalid email or password.";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- sign-in-errors`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/auth/sign-in-errors.ts apps/portal/tests/lib/auth/sign-in-errors.test.ts
git commit -m "$(cat <<'EOF'
feat(09): mapSignInError - specific sign-in error messages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `PasswordInput` component (show/hide)

**Files:**
- Create: `apps/portal/components/ui/password-input.tsx`

No unit test: this repo has no React component test harness (tests are pure-lib + API-route). Verified by typecheck + manual use in later tasks.

- [ ] **Step 1: Write the component**

Create `apps/portal/components/ui/password-input.tsx`:

```tsx
"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Password field with a show/hide toggle. Forwards all native input props
// (name, required, autoComplete, defaultValue, value/onChange, minLength).
// Defaults to hidden. The toggle is keyboard-reachable and not a submit button.
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-text-muted hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export { PasswordInput };
```

- [ ] **Step 2: Typecheck**

Run (from `apps/portal`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/ui/password-input.tsx
git commit -m "$(cat <<'EOF'
feat(09): PasswordInput - reusable show/hide password field

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Admin actions — `createUserAction` + `resetPasswordAction` + audit catalog

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/actions.ts` (replace `inviteUserAction` ~lines 26-71; add reset)
- Modify: `apps/portal/app/(admin)/admin/audit/page.tsx` (`KNOWN_ACTIONS` ~line 14)

No new unit test (Server Actions wrap the already-tested `provisionUser`; integration covered by Task 10 smoke). Validation reuses `validatePassword`.

- [ ] **Step 1: Replace the imports + invite action**

In `apps/portal/app/(admin)/admin/users/actions.ts`:

Change the invite import:
```ts
import { provisionUser } from "@/lib/users/provision";
```
(remove `import { inviteUser } from "@/lib/users/invite";`)

Add `validatePassword` to the validate import block:
```ts
import {
  validateEmail,
  validateFullName,
  validateRole,
  validatePassword,
} from "@/lib/users/validate";
```

Replace the whole `inviteUserAction` function (currently ~lines 26-71) with:

```ts
export async function createUserAction(input: {
  email: string;
  full_name: string;
  role: string;
  tempPassword: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const emailError = validateEmail(input.email);
  if (emailError) return { ok: false, error: emailError };

  const nameError = validateFullName(input.full_name);
  if (nameError) return { ok: false, error: nameError };

  const roleError = validateRole(input.role);
  if (roleError) return { ok: false, error: roleError };

  const pwError = validatePassword(input.tempPassword);
  if (pwError) return { ok: false, error: pwError };

  const admin = createAdminClient();
  const result = await provisionUser({
    admin,
    operatorId: actor.operator_id,
    input: {
      email: input.email.trim().toLowerCase(),
      full_name: input.full_name.trim(),
      role: input.role as Role,
      tempPassword: input.tempPassword,
    },
  });

  if (!result.ok) return result;

  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.created",
    entityType: "user",
    entityId: result.userId,
    details: {
      email: input.email.trim().toLowerCase(),
      role: input.role,
      full_name: input.full_name.trim(),
    },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
```

(The `env` import and `appUrl`/`redirectTo` are no longer needed by this action. Leave the `env` import if other actions in the file use it; otherwise remove it. Verify with `grep -n "env\." apps/portal/app/\(admin\)/admin/users/actions.ts`.)

- [ ] **Step 2: Add `resetPasswordAction` at the end of the file**

Append to `apps/portal/app/(admin)/admin/users/actions.ts`:

```ts
export async function resetPasswordAction(input: {
  targetUserId: string;
  tempPassword: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const pwError = validatePassword(input.tempPassword);
  if (pwError) return { ok: false, error: pwError };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, operator_id, email")
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  const admin = createAdminClient();

  const { error: pwUpdateError } = await admin.auth.admin.updateUserById(
    input.targetUserId,
    { password: input.tempPassword },
  );
  if (pwUpdateError) {
    return { ok: false, error: `Failed to reset password: ${pwUpdateError.message}` };
  }

  const { error: flagError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", input.targetUserId);
  if (flagError) {
    return { ok: false, error: `Failed to flag account: ${flagError.message}` };
  }

  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.password_reset_by_admin",
    entityType: "user",
    entityId: input.targetUserId,
    details: { email: target.email },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
```

- [ ] **Step 3: Add the new audit actions to the catalog**

In `apps/portal/app/(admin)/admin/audit/page.tsx`, update `KNOWN_ACTIONS` — add `"user.created"` after `"user.signed_out"` and `"user.password_reset_by_admin"` after `"user.password_reset"`:

```ts
const KNOWN_ACTIONS = [
  "user.signed_in",
  "user.signed_out",
  "user.created",
  "user.invited",
  "user.onboarded",
  "user.password_reset",
  "user.password_reset_by_admin",
  "user.profile_edited",
  "user.role_changed",
  "user.active_toggled",
  "user.deleted",
  // ...rest unchanged
```

- [ ] **Step 4: Typecheck**

Run (from `apps/portal`): `pnpm typecheck`
Expected: PASS. (The UI still imports `inviteUserAction` — that breaks the build only at lint/typecheck of `users-table.tsx`, fixed in Task 8. If typecheck fails solely on `users-table.tsx` referencing `inviteUserAction`, that is expected here and resolved in Task 8; proceed.)

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/users/actions.ts apps/portal/app/\(admin\)/admin/audit/page.tsx
git commit -m "$(cat <<'EOF'
feat(09): createUserAction + resetPasswordAction + audit catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Force-onboarding gate + clear flag on onboarding

**Files:**
- Modify: `apps/portal/lib/auth/require-role.ts`
- Modify: `apps/portal/app/(auth)/onboarding/actions.ts`
- Modify: `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`

- [ ] **Step 1: Gate in `requireRole`**

In `apps/portal/lib/auth/require-role.ts`:

Add `must_change_password` to the `RequiredProfile` type (after `active: boolean;`):
```ts
  active: boolean;
  must_change_password: boolean;
```

Add it to the select:
```ts
    .select("id, role, operator_id, active, must_change_password")
```

Insert the gate AFTER the `!profile.active` check and BEFORE the role check:
```ts
  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  if (profile.must_change_password) {
    redirect("/onboarding");
  }

  if (profile.role !== role) {
    redirect("/");
  }
```

- [ ] **Step 2: Clear the flag in the onboarding action**

In `apps/portal/app/(auth)/onboarding/actions.ts`, the action already updates `full_name` via the admin client inside an `if (nameChanged)` block. Replace that block so the flag is ALWAYS cleared (even when the name is unchanged). Find:

```ts
  const nameChanged = profile != null && profile.full_name !== fullName;

  if (nameChanged) {
    const { error: nameUpdateError } = await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    if (nameUpdateError) {
      return {
        error:
          "Password saved, but couldn't update your name. Try again from your account page.",
      };
    }
  }
```

Replace with:

```ts
  const nameChanged = profile != null && profile.full_name !== fullName;

  // Always clear must_change_password (the onboarding gate) here, and set the
  // name in the same write when it changed. Admin client => auth.uid() is null
  // => the 0012 self-column guard is skipped.
  const profileUpdate: { must_change_password: boolean; full_name?: string } = {
    must_change_password: false,
  };
  if (nameChanged) profileUpdate.full_name = fullName;

  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update(profileUpdate)
    .eq("id", user.id);
  if (profileUpdateError) {
    return {
      error:
        "Password saved, but couldn't finish setup. Try again from your account page.",
    };
  }
```

(Leave the `user.onboarded` audit `details: { name_changed: nameChanged }` as-is.)

- [ ] **Step 3: Add the password-requirement helper text**

In `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`, add a helper line under the New password input. After the `<Input id="onboard-password" ... />` element, before its closing `</div>`, add:

```tsx
        <p className="text-xs text-text-muted">Must be at least 8 characters.</p>
```

- [ ] **Step 4: Typecheck**

Run (from `apps/portal`): `pnpm typecheck`
Expected: PASS (Task 8 still pending for `users-table.tsx` — same caveat as Task 5 Step 4).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/auth/require-role.ts apps/portal/app/\(auth\)/onboarding/actions.ts apps/portal/app/\(auth\)/onboarding/onboarding-form.tsx
git commit -m "$(cat <<'EOF'
feat(09): force onboarding via must_change_password + clear flag on finish

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Sign-in — specific errors + block deactivated

**Files:**
- Modify: `apps/portal/app/(auth)/sign-in/actions.ts`

- [ ] **Step 1: Rewrite `signInAction`**

Replace the body of `apps/portal/app/(auth)/sign-in/actions.ts` with:

```ts
"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { logSignIn } from "@/lib/auth/audit";
import { mapSignInError } from "@/lib/auth/sign-in-errors";

export type SignInState = {
  error: string | null;
};

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: mapSignInError({ code: error?.code, status: error?.status }) };
  }

  // Block deactivated users with a specific message. GoTrue authenticates them
  // (active is our app flag, not GoTrue's), so sign them back out before any
  // protected route silently bounces them to /sign-in.
  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return {
      error: "This account has been deactivated. Please contact your administrator.",
    };
  }

  await logSignIn(data.user.id);
  redirect("/");
}
```

- [ ] **Step 2: Run the full suite + typecheck**

Run: `pnpm test -- sign-in-errors` → PASS (helper unchanged).
Run (from `apps/portal`): `pnpm typecheck` → PASS (same Task 8 caveat for `users-table.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/app/\(auth\)/sign-in/actions.ts
git commit -m "$(cat <<'EOF'
feat(09): sign-in specific error states + block deactivated users

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Admin Users UI — temp-password field, reset dialog, pending badge

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/page.tsx` (select + pass-through)
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx`

- [ ] **Step 1: Select the flag in the page**

In `apps/portal/app/(admin)/admin/users/page.tsx`, add `must_change_password` to the select:

```ts
    .select(
      "id, full_name, email, role, status, active, last_seen_at, created_at, must_change_password",
    )
```

- [ ] **Step 2: Update `UserRow` + imports in `users-table.tsx`**

In `apps/portal/app/(admin)/admin/users/users-table.tsx`:

Add to the `UserRow` type (after `active: boolean;`):
```ts
  must_change_password: boolean;
```

Update the actions import (replace `inviteUserAction` with the two new actions):
```ts
import {
  createUserAction,
  resetPasswordAction,
  updateUserAction,
  hardDeleteUserAction,
} from "./actions";
```

Add `PasswordInput` + a `KeyRound` icon import:
```ts
import { PasswordInput } from "@/components/ui/password-input";
```
and add `KeyRound` to the existing lucide import:
```ts
import { UserRound, UserPlus, MoreHorizontal, KeyRound } from "lucide-react";
```

- [ ] **Step 3: Replace `InviteDialog` with `CreateUserDialog`**

Replace the entire `InviteDialog` function with:

```tsx
function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createUserAction({
        email: String(formData.get("email") ?? ""),
        full_name: String(formData.get("full_name") ?? ""),
        role: String(formData.get("role") ?? ""),
        tempPassword: String(formData.get("tempPassword") ?? ""),
      });

      if (result.ok) {
        toast.success("User created. Share their temporary password — they'll set their own at first sign-in.");
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a user</DialogTitle>
          <DialogDescription>
            Set a temporary password and share it with them. They&apos;ll be
            asked to choose their own at first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input id="create-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-name">Full name</Label>
            <Input id="create-name" name="full_name" type="text" required autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-role">Role</Label>
            <Select name="role" defaultValue="AGENT">
              <SelectTrigger id="create-role">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-password">Temporary password</Label>
            <PasswordInput
              id="create-password"
              name="tempPassword"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-text-muted">At least 8 characters.</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add a `ResetPasswordDialog` component**

Add this new function above `RowActions`:

```tsx
function ResetPasswordDialog(props: {
  user: UserRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await resetPasswordAction({
        targetUserId: props.user.id,
        tempPassword: String(formData.get("tempPassword") ?? ""),
      });
      if (result.ok) {
        toast.success("Password reset. Share the temporary password — they'll set a new one at next sign-in.");
        props.onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {props.user.full_name}</DialogTitle>
          <DialogDescription>
            Set a temporary password and share it with them. They&apos;ll be
            asked to choose a new one at next sign-in.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">Temporary password</Label>
            <PasswordInput
              id="reset-password"
              name="tempPassword"
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-text-muted">At least 8 characters.</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the reset dialog into `RowActions`**

In `RowActions`, add a state var with the other `useState` hooks:
```tsx
  const [resetOpen, setResetOpen] = useState(false);
```

Add a menu item in `DropdownMenuContent` after the Edit item (available for any user, including self):
```tsx
          <DropdownMenuItem onSelect={() => setResetOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Reset password
          </DropdownMenuItem>
```

Render the dialog alongside `EditSheet` (after `<EditSheet ... />`):
```tsx
      <ResetPasswordDialog
        user={user}
        open={resetOpen}
        onOpenChange={setResetOpen}
      />
```

- [ ] **Step 6: Add the "Pending setup" badge + rename the column header**

In `UsersTable`, change `<InviteDialog />` to `<CreateUserDialog />`.

Rename the `Invited` column header to `Added`:
```tsx
                <TableHead>Added</TableHead>
```

In the Name cell, append a badge when the flag is set. Replace the Name `<TableCell>`:
```tsx
                  <TableCell className="font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      {u.full_name}
                      {u.must_change_password ? (
                        <Badge variant="outline" className="text-xs font-normal text-text-muted">
                          Pending setup
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
```

Also update the empty-state copy "Invite your first user to get started." → "Add your first user to get started."

- [ ] **Step 7: Typecheck + lint**

Run (from `apps/portal`): `pnpm typecheck` → PASS (the `inviteUserAction` reference is now gone).
Run (from repo root): `pnpm lint` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/users/page.tsx apps/portal/app/\(admin\)/admin/users/users-table.tsx
git commit -m "$(cat <<'EOF'
feat(09): users UI - temp password, reset dialog, pending-setup badge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: PasswordInput on sign-in, onboarding, update-password + dormant forgot link

**Files:**
- Modify: `apps/portal/app/(auth)/sign-in/page.tsx`
- Modify: `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`
- Modify: `apps/portal/app/auth/update-password/page.tsx`
- Modify: `apps/portal/app/auth/update-password/actions.ts`

- [ ] **Step 1: Sign-in page — PasswordInput + forgot-link copy**

In `apps/portal/app/(auth)/sign-in/page.tsx`, add the import at top:
```tsx
import { PasswordInput } from "@/components/ui/password-input";
```

Replace the password `<input ...>` (the one with `name="password"`) with:
```tsx
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
          className="h-auto rounded-md border-input bg-background px-3 py-2"
        />
```

Replace the "Forgot password?" anchor (the `<a href="/forgot-password">…</a>`) with static guidance:
```tsx
      <p className="text-center text-sm text-text-muted">
        Forgot your password? Contact your administrator.
      </p>
```

- [ ] **Step 2: Onboarding form — PasswordInput for both fields**

In `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`, add the import:
```tsx
import { PasswordInput } from "@/components/ui/password-input";
```

Replace the New password `<Input id="onboard-password" ... />` with:
```tsx
        <PasswordInput
          id="onboard-password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
```

Replace the Confirm password `<Input id="onboard-confirm" ... />` with:
```tsx
        <PasswordInput
          id="onboard-confirm"
          name="confirm"
          required
          autoComplete="new-password"
        />
```

(The "Must be at least 8 characters." helper added in Task 6 stays under the new-password field.)

- [ ] **Step 3: Update-password page — PasswordInput + reuse validatePassword**

In `apps/portal/app/auth/update-password/page.tsx`, swap its two password inputs to `PasswordInput` the same way (import `PasswordInput`; replace the password + confirm `<Input type="password" ... />` with `<PasswordInput ... />`, keeping their existing `name`, `required`, `autoComplete`, `minLength` props). Add a helper line `<p className="text-xs text-text-muted">Must be at least 8 characters.</p>` under the new-password field if not present.

In `apps/portal/app/auth/update-password/actions.ts`, replace the inline length check with the shared validator for consistency. Add the import:
```ts
import { validatePassword } from "@/lib/users/validate";
```
Replace:
```ts
  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }
```
with:
```ts
  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }
```

- [ ] **Step 4: Typecheck + lint**

Run (from `apps/portal`): `pnpm typecheck` → PASS.
Run (from repo root): `pnpm lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/\(auth\)/sign-in/page.tsx apps/portal/app/\(auth\)/onboarding/onboarding-form.tsx apps/portal/app/auth/update-password/page.tsx apps/portal/app/auth/update-password/actions.ts
git commit -m "$(cat <<'EOF'
feat(09): show-password toggle on all auth forms + dormant forgot link

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full verification, broken-user recovery, dashboard policy, tag

**Files:** none (verification + ops)

- [ ] **Step 1: Full local gate**

Run (from `apps/portal`): `pnpm test` → all green (provision 5, sign-in-errors 4, plus prior suite; the deleted `invite.test.ts` is gone).
Run (from `apps/portal`): `pnpm typecheck` → PASS.
Run (from repo root): `pnpm lint` → PASS.

- [ ] **Step 2: Local smoke — create + forced change**

With local Supabase + `pnpm dev`: sign in as the seed admin, go to `/admin/users` → Add user (role AGENT, temp password e.g. `temp1234`). Sign out, sign in as that user → you should be redirected to `/onboarding`, set a new password, land on the agent dashboard. The "Pending setup" badge should disappear after onboarding (refresh `/admin/users`).

- [ ] **Step 3: Local smoke — error states + guard**

- Wrong password → "Invalid email or password." Show-password eye toggles all fields.
- Deactivate the test agent (admin) → that user signs in → "This account has been deactivated. Please contact your administrator."
- Self-update guard: signed in as the non-admin agent, in browser devtools run a PATCH against `/rest/v1/profiles?id=eq.<self>` setting `role=ADMIN` (or simply trust the trigger) — expect a 4xx/`profiles: only full_name is self-editable`. (Optional but recommended once.)

- [ ] **Step 4: Reset password smoke**

As admin, on the test agent → Reset password → set `temp5678`. Sign in as the agent with `temp5678` → forced back to `/onboarding`.

- [ ] **Step 5: Production prep notes (do NOT run blind — coordinate with Kumar)**

Record in `memory/project-status.md` under launch:
- Set Supabase prod **Auth → Providers → Email → Minimum password length = 8**.
- Recover the two broken prod users (`bovarovadilnoza0@gmail.com`, `kumar@unbrandt.com`): admin → Users → Reset password → temp password → they sign in → forced onboarding. No delete/recreate.
- Email invite/reset remain dormant; `/auth/confirm` + `docs/setup/2026-06-04-auth-email-templates.md` are the re-enable seam for when SMTP lands.

- [ ] **Step 6: Update status docs + tag**

Update `CLAUDE.md` build-status table (add Plan 9 row) and `memory/project-status.md` (mark Plan 9 complete; provisioning is now email-free; the invite/SMTP blocker is resolved for the pilot). Then:

```bash
git add CLAUDE.md memory/project-status.md
git commit -m "$(cat <<'EOF'
docs(09): mark email-free admin provisioning complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
git tag plan-09-admin-provisioning-complete
```

---

## Self-Review

**Spec coverage:**
- §B data model (column + guard) → Task 1. ✓
- §C provisioning (createUser, no email) → Task 2 (`provisionUser`) + Task 5 (`createUserAction`). ✓
- §D force-change gate + onboarding clear → Task 6. ✓
- §E sign-in errors + deactivated block → Task 3 (mapper) + Task 7 (action). ✓
- §F admin reset + broken-user recovery → Task 5 (`resetPasswordAction`) + Task 8 (UI) + Task 10 Step 5. ✓
- §G forgot-password dormant link → Task 9 Step 1. ✓
- §H password rule conveyance (helper text, unify `validatePassword`, dashboard min) → Task 6 Step 3, Task 9 Step 3, Task 10 Step 5. ✓
- §I "Pending setup" badge → Task 8 Step 6. ✓
- §L show-password toggle on all fields → Task 4 + Task 8 (create/reset) + Task 9 (sign-in/onboarding/update-password). ✓
- §J testing → Tasks 2, 3 (unit) + Task 10 (smoke). ✓
- §"Security finding" RLS guard → Task 1. ✓
- Audit catalog additions → Task 5 Step 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. "fill in details" absent. ✓

**Type/name consistency:**
- `provisionUser({ admin, operatorId, input: { email, full_name, role, tempPassword } })` — defined Task 2, called identically Task 5. ✓
- `createUserAction` / `resetPasswordAction` — defined Task 5, imported + called Task 8. ✓
- `mapSignInError({ code?, status? })` — defined Task 3, called Task 7 with `{ code: error?.code, status: error?.status }`. ✓
- `must_change_password` — added to types (Task 1), inserted (Task 2), selected/gated (Task 6), selected/rendered (Task 8). ✓
- `PasswordInput` (Omit `type`) — defined Task 4, used Tasks 8–9. ✓
- Audit actions `user.created` / `user.password_reset_by_admin` — written Task 5, cataloged Task 5 Step 3. ✓

**Known intermediate-state note:** Tasks 5–7 leave `users-table.tsx` importing the now-removed `inviteUserAction`, so portal typecheck of that file fails until Task 8. Each affected step calls this out. Build/lint go green at Task 8.
