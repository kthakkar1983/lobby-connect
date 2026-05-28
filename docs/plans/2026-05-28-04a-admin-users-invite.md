# Admin Layout + Users CRUD + Invite/Onboarding Implementation Plan (Plan 4a of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin placeholder card with a real shell (collapsed icon-sidebar + hover-expand, profile menu, sign-out), build the `/admin/users` table with invite / edit / deactivate / hard-delete actions, and ship the `/onboarding` page where invited users set their password and confirm their name. Every meaningful mutation writes an audit row.

**Architecture:** The admin route group's layout renders a shadcn `Sidebar` shell once and wraps every nested admin page — `/admin/users` for this plan, `/admin/properties` and `/admin/assignments` for 4b / 4c. The users table is a Server Component (fetches `profiles` via the user-scoped server client) feeding a Client Component (`users-table.tsx`) that owns the Invite Dialog, Edit Sheet, Deactivate AlertDialog, and Hard-Delete AlertDialog. Three Server Actions (`inviteUserAction`, `updateUserAction`, `hardDeleteUserAction`) are thin wrappers around tested `lib/users/{invite,validate,guards}.ts` helpers; they use the service-role admin client to mutate Supabase Auth + `profiles` and to write audit rows. `/onboarding` lives in the `(auth)` route group (same centered-card shell as `/sign-in`) and is its own self-contained Server Action.

**Tech stack:**
- Next.js 15 App Router + React 19 (already installed)
- `@supabase/ssr` ^0.10.3 + `@supabase/supabase-js` ^2.45 (already installed)
- shadcn/ui (`new-york` style, already configured — `components.json` exists, only `button.tsx` is installed; this plan adds more components)
- Tailwind v4 (already installed)
- lucide-react ^1.16 (already installed — used for nav icons)
- Vitest (already configured)

---

## Plan roadmap (you are here: Plan 4a)

| # | Plan | Outputs |
|---|---|---|
| 1 | Foundation | Shell that boots, lints, tests, typechecks |
| 2 | Database & RLS | `0001_init.sql`, `0002_rls.sql`, `seed.sql`, hand-written TS types |
| 3 | Auth & role routing | Supabase SSR clients, middleware gate, sign-in/out/forgot/update-password, role layouts |
| **4a** | **Admin layout + users CRUD + invite/onboarding** ← *this plan* | Admin shell, `/admin/users` table, invite Server Action, `/onboarding` page, migration 0003 (audit FK fix), middleware matcher fix |
| 4b | Properties CRUD | `/admin/properties` list + detail + create/edit/delete |
| 4c | Assignments + `admin_call_availability` | Property-agent assignment UI, per-property accepting-calls toggle |
| 5 | Voice path & agent dashboard | Twilio webhooks, parallel-dial TwiML, softphone, call history |
| 6 | Owner portal | Mobile-first properties + recordings + kiosk message editing |
| 7 | Kiosk | K-01→K-04→K-08, Agora client, kiosk→portal API |
| 8 | Observability | Sentry, `/status` page, `/audit` page, stale-OFFLINE cron |

---

## Pre-flight (one-time, do once before Task 1)

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git status                          # expect clean working tree on main
git describe --tags --abbrev=0      # expect plan-03-auth-routing-complete
pnpm --version                      # expect 9.x
pnpm typecheck                      # expect pass
pnpm test                           # expect pass (portal smoke + auth tests + kiosk smoke)
```

If any of these fails, fix before starting.

### Local Supabase setup (required for Task 13 smoke, optional otherwise)

If Docker Desktop is installed:
```bash
pnpm supabase:start                 # boots the local stack (Inbucket at :54324)
pnpm exec supabase db reset         # applies migrations 0001 + 0002 + seed
```

If Docker isn't running, code-level tasks 1–12 still pass — only the manual smoke in Task 13 requires it.

---

## Reference docs (open in a second tab)

- `docs/specs/2026-05-28-admin-users-invite-design.md` — locked design decisions for this plan
- `docs/specs/2026-05-27-v1-architecture-design.md` — §6.1 (auth flow), §6.2 (RLS), §9 (UI baseline)
- `docs/plans/2026-05-27-03-auth-role-routing.md` — Plan 3, the predecessor (audit helper, requireRole, middleware shape, sign-in page conventions)
- Supabase Admin API: https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
- shadcn/ui Sidebar: https://ui.shadcn.com/docs/components/sidebar

**Seeded admin credentials (from `supabase/seed.sql`):**
- Email: `admin@lobbyconnect.local`
- Password: `localdev123`
- UUID: `00000000-0000-0000-0000-0000000000b1`
- Operator: `00000000-0000-0000-0000-0000000000a0`

---

## File map (what exists after this plan)

```
supabase/migrations/
└── 0003_audit_actor_set_null.sql            ← Task 2 (new)

apps/portal/
├── middleware.ts                            ← Task 1 (modified — matcher)
├── components.json                          ← unchanged (shadcn config)
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx                       ← unchanged (Plan 3)
│   │   └── onboarding/
│   │       ├── page.tsx                     ← Task 12 (new)
│   │       └── actions.ts                   ← Task 12 (new)
│   └── (admin)/
│       ├── layout.tsx                       ← Task 4 (modified — render shell)
│       └── admin/
│           ├── page.tsx                     ← Task 4 (modified — overview stub)
│           └── users/
│               ├── page.tsx                 ← Task 8 (new — Server Component)
│               ├── users-table.tsx          ← Task 8 (new — Client Component)
│               └── actions.ts               ← Tasks 9 + 10 + 11 (new)
├── components/
│   ├── ui/                                  ← Task 3 (shadcn adds files here)
│   │   ├── button.tsx                       ← unchanged
│   │   ├── sidebar.tsx                      ← Task 3 (new)
│   │   ├── dropdown-menu.tsx                ← Task 3 (new)
│   │   ├── dialog.tsx                       ← Task 3 (new)
│   │   ├── sheet.tsx                        ← Task 3 (new)
│   │   ├── alert-dialog.tsx                 ← Task 3 (new)
│   │   ├── table.tsx                        ← Task 3 (new)
│   │   ├── badge.tsx                        ← Task 3 (new)
│   │   ├── select.tsx                       ← Task 3 (new)
│   │   ├── switch.tsx                       ← Task 3 (new)
│   │   ├── input.tsx                        ← Task 3 (new)
│   │   ├── label.tsx                        ← Task 3 (new)
│   │   ├── separator.tsx                    ← Task 3 (new)
│   │   ├── tooltip.tsx                      ← Task 3 (new)
│   │   ├── skeleton.tsx                     ← Task 3 (new)
│   │   └── sonner.tsx                       ← Task 3 (new)
│   ├── app-sidebar.tsx                      ← Task 4 (new)
│   ├── user-menu.tsx                        ← Task 4 (new)
│   └── nav-item.tsx                         ← Task 4 (new)
├── hooks/
│   └── use-mobile.ts                        ← Task 3 (shadcn sidebar dependency)
├── lib/
│   └── users/
│       ├── validate.ts                      ← Task 5 (new)
│       ├── guards.ts                        ← Task 6 (new)
│       └── invite.ts                        ← Task 7 (new)
└── tests/
    └── lib/users/
        ├── validate.test.ts                 ← Task 5 (new)
        ├── guards.test.ts                   ← Task 6 (new)
        └── invite.test.ts                   ← Task 7 (new)
```

No `apps/kiosk` or `packages/shared` changes in this plan.

---

## Task 1: Fix the middleware matcher

**Files:**
- Modify: `apps/portal/middleware.ts`

Plan 3's matcher excludes `/sign-in` and `/auth/*` but not `/forgot-password`, so unauthed users who click "Forgot password?" get bounced back to `/sign-in`. We're also adding `/onboarding`, which a fresh invitee will land on with a recovery session — they're authenticated by then so middleware wouldn't redirect them anyway, but adding the explicit exclusion makes the policy consistent ("auth-related URLs are always reachable").

- [ ] **Step 1: Replace the matcher.**

In `apps/portal/middleware.ts`, replace the existing `config` export at the bottom of the file (lines 27–38) with:

```ts
export const config = {
  matcher: [
    // Match every path EXCEPT:
    //   - _next/static (build assets)
    //   - _next/image (image optimization)
    //   - favicon.ico
    //   - api/* (API routes do their own auth)
    //   - sign-in (the sign-in page itself)
    //   - forgot-password (must be reachable for unauthed users — Plan 3 bug)
    //   - onboarding (invitee landing; always has a session, but kept explicit)
    //   - auth/* (sign-out POST + password-reset/callback routes)
    "/((?!_next/static|_next/image|favicon.ico|api/|sign-in|forgot-password|onboarding|auth/).*)",
  ],
};
```

The body of `middleware` (above `config`) is unchanged.

- [ ] **Step 2: Typecheck.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/portal/middleware.ts
git commit -m "fix(portal): middleware matcher excludes forgot-password and onboarding"
```

---

## Task 2: Migration 0003 — audit FK becomes ON DELETE SET NULL

**Files:**
- Create: `supabase/migrations/0003_audit_actor_set_null.sql`

`audit_logs.actor_user_id` references `profiles(id)` with the default `NO ACTION` rule, so hard-deleting a user with prior audit rows fails with a FK violation. Switching to `ON DELETE SET NULL` preserves history (action + entity stay) while letting hard deletes succeed. The constraint name is the Postgres-auto-generated `audit_logs_actor_user_id_fkey`.

- [ ] **Step 1: Create the migration.**

File `supabase/migrations/0003_audit_actor_set_null.sql`:

```sql
-- 0003_audit_actor_set_null.sql
-- Switch audit_logs.actor_user_id FK to ON DELETE SET NULL so admin hard-deletes
-- don't fail on existing audit rows authored by the deleted user. Post-delete,
-- the audit row still preserves action + entity_type + entity_id + details —
-- only the actor identity is dropped to null.
--
-- Plan: docs/plans/2026-05-28-04a-admin-users-invite.md
-- Spec: docs/specs/2026-05-28-admin-users-invite-design.md (§3.5)
--
-- Idempotent: drops by name (if exists), then re-adds.

alter table audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;

alter table audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key (actor_user_id)
  references profiles(id)
  on delete set null;
```

- [ ] **Step 2: Apply locally (only if Docker is up).**

```bash
pnpm exec supabase db reset
```

Expected: all migrations replay cleanly, seed runs without error. If Docker is not running, skip this step — the smoke in Task 13 will catch any SQL error.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/0003_audit_actor_set_null.sql
git commit -m "feat(db): audit_logs.actor_user_id → ON DELETE SET NULL (0003)"
```

---

## Task 3: Install shadcn components

**Files:**
- Add: `apps/portal/components/ui/{sidebar,dropdown-menu,dialog,sheet,alert-dialog,table,badge,select,switch,input,label,separator,tooltip,skeleton,sonner}.tsx`
- Add: `apps/portal/hooks/use-mobile.ts` (sidebar dependency)
- Modify: `apps/portal/package.json` (transitive deps shadcn pulls in)

shadcn's CLI is the right tool here — it writes the canonical component code into our repo (we own the source). `components.json` is already configured to write to `@/components/ui` with the `new-york` style. The list below is exactly what this plan and 4b/4c will need. We install them all in one task to avoid repeated commits.

- [ ] **Step 1: Run the shadcn CLI from the portal directory.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect/apps/portal"
pnpm dlx shadcn@latest add sidebar dropdown-menu dialog sheet alert-dialog table badge select switch input label separator tooltip skeleton sonner
```

Expected: CLI writes ~16 files under `components/ui/`, plus `hooks/use-mobile.ts` (sidebar uses it). It may also install transitive dependencies (`@radix-ui/react-*`, `next-themes`, `sonner`). Accept any prompts to overwrite.

- [ ] **Step 2: If the CLI asks about `tailwind.config.ts` or globals.css updates, accept the defaults.**

Tailwind v4 reads tokens from `app/globals.css` via the `@theme` block we already maintain. shadcn's new-york preset should slot in without conflict because our token names already match shadcn conventions (background, foreground, primary, etc.).

- [ ] **Step 3: Add `sonner` toaster to the root layout.**

The toaster mounts globally so any Server Action can flash a toast on the client. Open `apps/portal/app/layout.tsx` and verify it imports + renders the toaster. If the file currently doesn't render `<Toaster />`, add the import at the top and the component inside the `<body>` (after `{children}`):

```tsx
import { Toaster } from "@/components/ui/sonner";
// ...
<body>
  {children}
  <Toaster />
</body>
```

If `app/layout.tsx` was untouched by Plan 3 and is a minimal shell, leave the rest alone — only add the import + the `<Toaster />` element.

- [ ] **Step 4: Typecheck + lint.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
```

Expected: both PASS. If lint reports unused-imports inside the new shadcn files, leave them — they're library code and we don't edit shadcn output by hand.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/components/ui apps/portal/hooks apps/portal/app/layout.tsx apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(portal): add shadcn components for admin shell + dialogs + table"
```

---

## Task 4: Admin layout shell — sidebar + header + overview stub

**Files:**
- Create: `apps/portal/components/nav-item.tsx`
- Create: `apps/portal/components/app-sidebar.tsx`
- Create: `apps/portal/components/user-menu.tsx`
- Modify: `apps/portal/app/(admin)/layout.tsx`
- Modify: `apps/portal/app/(admin)/admin/page.tsx`

The shell renders once and wraps every nested admin page. Sidebar is collapsed-by-default with hover-expand (`collapsible="icon"`), logo at the top is a link to `/admin`, and four nav items (Users / Properties / Assignments / Settings) live under the logo. The header sits to the right of the sidebar and contains a user menu with the current admin's name, role badge, and sign-out form.

- [ ] **Step 1: Create the nav item.**

File `apps/portal/components/nav-item.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Props = {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
};

export function NavItem({ href, label, icon: Icon }: Props) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 2: Create the app sidebar.**

File `apps/portal/components/app-sidebar.tsx`:
```tsx
import Link from "next/link";
import { Building2, Settings, Users, UsersRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavItem } from "@/components/nav-item";

const NAV_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/assignments", label: "Assignments", icon: UsersRound },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/admin"
          className="flex h-10 items-center gap-2 px-2 font-semibold text-foreground"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground text-xs">
            LC
          </span>
          <span className="group-data-[collapsible=icon]:hidden">
            Lobby Connect
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.href} {...item} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
```

- [ ] **Step 3: Create the user menu.**

File `apps/portal/components/user-menu.tsx`:
```tsx
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  readonly fullName: string;
  readonly email: string;
  readonly role: "ADMIN" | "AGENT" | "OWNER";
};

export function UserMenu({ fullName, email, role }: Props) {
  const initials = fullName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
            {initials || "?"}
          </span>
          <span className="hidden md:inline">{fullName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-medium">{fullName}</span>
          <span className="text-xs text-text-muted">{email}</span>
          <Badge variant="secondary" className="mt-1 w-fit">
            {role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2 text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Rewrite the admin layout to render the shell.**

File `apps/portal/app/(admin)/layout.tsx` (full replacement):
```tsx
import { requireRole } from "@/lib/auth/require-role";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { createServerClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("ADMIN");

  // requireRole returns id/role/operator_id/active but we also need name + email
  // for the header. One extra small query — cheap and avoids changing the
  // requireRole signature for one consumer.
  const supabase = await createServerClient();
  const { data: identity } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <SidebarTrigger />
          <UserMenu
            fullName={identity?.full_name ?? ""}
            email={identity?.email ?? ""}
            role={profile.role as "ADMIN"}
          />
        </header>
        <div className="p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 5: Replace the admin overview page.**

File `apps/portal/app/(admin)/admin/page.tsx` (full replacement):
```tsx
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";

export default function AdminOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Admin overview
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage users, properties, and assignments for your operator.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/users"
          className="group flex items-start justify-between rounded-lg border border-border bg-card p-5 transition hover:border-primary"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">
                Users
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Invite admins, agents, and owners. Edit roles. Deactivate or
              remove access.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted transition group-hover:text-primary" />
        </Link>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + lint + run dev briefly to confirm the shell renders.**

```bash
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
```

Expected: both PASS. Skip `pnpm dev` here — visual check happens in Task 13.

- [ ] **Step 7: Commit.**

```bash
git add apps/portal/components/nav-item.tsx \
        apps/portal/components/app-sidebar.tsx \
        apps/portal/components/user-menu.tsx \
        "apps/portal/app/(admin)/layout.tsx" \
        "apps/portal/app/(admin)/admin/page.tsx"
git commit -m "feat(portal): admin layout shell — sidebar, user menu, overview stub"
```

---

## Task 5: `lib/users/validate.ts` (TDD)

**Files:**
- Test: `apps/portal/tests/lib/users/validate.test.ts`
- Create: `apps/portal/lib/users/validate.ts`

Pure validators reused by both the invite Server Action and the onboarding action. Keeping them out of the actions makes them trivially testable.

- [ ] **Step 1: Write the failing test.**

File `apps/portal/tests/lib/users/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("validateEmail", () => {
  it("accepts a normal email", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("admin@example.com")).toBeNull();
  });

  it("rejects an empty string", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("")).toBe("Enter an email address.");
  });

  it("rejects a malformed value", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("not-an-email")).toBe("Enter a valid email address.");
  });

  it("trims surrounding whitespace before checking", async () => {
    const { validateEmail } = await import("@/lib/users/validate");
    expect(validateEmail("  admin@example.com  ")).toBeNull();
  });
});

describe("validateFullName", () => {
  it("accepts a normal name", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("Ada Lovelace")).toBeNull();
  });

  it("rejects an empty string", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("")).toBe("Enter a full name.");
  });

  it("rejects whitespace-only", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("   ")).toBe("Enter a full name.");
  });

  it("rejects names over 120 characters", async () => {
    const { validateFullName } = await import("@/lib/users/validate");
    expect(validateFullName("a".repeat(121))).toBe(
      "Full name must be 120 characters or fewer.",
    );
  });
});

describe("validateRole", () => {
  it("accepts ADMIN, AGENT, OWNER", async () => {
    const { validateRole } = await import("@/lib/users/validate");
    expect(validateRole("ADMIN")).toBeNull();
    expect(validateRole("AGENT")).toBeNull();
    expect(validateRole("OWNER")).toBeNull();
  });

  it("rejects anything else", async () => {
    const { validateRole } = await import("@/lib/users/validate");
    expect(validateRole("admin")).toBe("Choose a valid role.");
    expect(validateRole("SUPER")).toBe("Choose a valid role.");
    expect(validateRole("")).toBe("Choose a valid role.");
  });
});

describe("validatePassword", () => {
  it("accepts an 8+ character password", async () => {
    const { validatePassword } = await import("@/lib/users/validate");
    expect(validatePassword("password1")).toBeNull();
  });

  it("rejects short passwords", async () => {
    const { validatePassword } = await import("@/lib/users/validate");
    expect(validatePassword("abc")).toBe(
      "Password must be at least 8 characters.",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/validate.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/users/validate'`.

- [ ] **Step 3: Write the implementation.**

File `apps/portal/lib/users/validate.ts`:
```ts
// Pure validators for user-facing input. Return null on success, a
// user-readable error message on failure. Designed to be reused by Server
// Actions and the onboarding flow without pulling in Supabase or React.

import type { Role } from "@lc/shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: ReadonlyArray<Role> = ["ADMIN", "AGENT", "OWNER"];

export function validateEmail(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter an email address.";
  if (!EMAIL_RE.test(trimmed)) return "Enter a valid email address.";
  return null;
}

export function validateFullName(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "Enter a full name.";
  if (trimmed.length > 120) {
    return "Full name must be 120 characters or fewer.";
  }
  return null;
}

export function validateRole(input: string): string | null {
  if (!VALID_ROLES.includes(input as Role)) return "Choose a valid role.";
  return null;
}

export function validatePassword(input: string): string | null {
  if (input.length < 8) return "Password must be at least 8 characters.";
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/validate.test.ts
```

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/users/validate.ts apps/portal/tests/lib/users/validate.test.ts
git commit -m "feat(portal): lib/users/validate — email/name/role/password validators with tests"
```

---

## Task 6: `lib/users/guards.ts` (TDD)

**Files:**
- Test: `apps/portal/tests/lib/users/guards.test.ts`
- Create: `apps/portal/lib/users/guards.ts`

Self-edit guards. Pure functions over `{ actorId, targetId, patch }`. Used by `updateUserAction` and `hardDeleteUserAction` to refuse dangerous self-mutations regardless of what the UI sends.

- [ ] **Step 1: Write the failing test.**

File `apps/portal/tests/lib/users/guards.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("assertNotSelfDemote", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "b",
        patch: { role: "AGENT" },
      }),
    ).toBeNull();
  });

  it("returns null when actor == target but patch has no role change", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "a",
        patch: { full_name: "New Name" },
      }),
    ).toBeNull();
  });

  it("rejects when actor == target and role is in patch", async () => {
    const { assertNotSelfDemote } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDemote({
        actorId: "a",
        targetId: "a",
        patch: { role: "AGENT" },
      }),
    ).toBe("You can't change your own role.");
  });
});

describe("assertNotSelfDeactivate", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "b",
        patch: { active: false },
      }),
    ).toBeNull();
  });

  it("returns null when patch sets active=true on self", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "a",
        patch: { active: true },
      }),
    ).toBeNull();
  });

  it("rejects when actor == target and patch sets active=false", async () => {
    const { assertNotSelfDeactivate } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDeactivate({
        actorId: "a",
        targetId: "a",
        patch: { active: false },
      }),
    ).toBe("You can't deactivate yourself.");
  });
});

describe("assertNotSelfDelete", () => {
  it("returns null when actor != target", async () => {
    const { assertNotSelfDelete } = await import("@/lib/users/guards");
    expect(
      assertNotSelfDelete({ actorId: "a", targetId: "b" }),
    ).toBeNull();
  });

  it("rejects when actor == target", async () => {
    const { assertNotSelfDelete } = await import("@/lib/users/guards");
    expect(assertNotSelfDelete({ actorId: "a", targetId: "a" })).toBe(
      "You can't delete yourself.",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/guards.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/users/guards'`.

- [ ] **Step 3: Write the implementation.**

File `apps/portal/lib/users/guards.ts`:
```ts
// Self-edit guards. Pure functions returning either null (allowed) or a
// user-readable error message (rejected). Called by Server Actions before
// any DB mutation to enforce the "admin can't lock themselves out" rule
// regardless of what the client sent.

import type { Role } from "@lc/shared";

export type UserPatch = {
  full_name?: string;
  role?: Role;
  active?: boolean;
};

type EditArgs = {
  actorId: string;
  targetId: string;
  patch: UserPatch;
};

export function assertNotSelfDemote(args: EditArgs): string | null {
  if (args.actorId !== args.targetId) return null;
  if (args.patch.role === undefined) return null;
  return "You can't change your own role.";
}

export function assertNotSelfDeactivate(args: EditArgs): string | null {
  if (args.actorId !== args.targetId) return null;
  if (args.patch.active !== false) return null;
  return "You can't deactivate yourself.";
}

export function assertNotSelfDelete(args: {
  actorId: string;
  targetId: string;
}): string | null {
  if (args.actorId !== args.targetId) return null;
  return "You can't delete yourself.";
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/guards.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/users/guards.ts apps/portal/tests/lib/users/guards.test.ts
git commit -m "feat(portal): lib/users/guards — self-edit guards with tests"
```

---

## Task 7: `lib/users/invite.ts` (TDD)

**Files:**
- Test: `apps/portal/tests/lib/users/invite.test.ts`
- Create: `apps/portal/lib/users/invite.ts`

The core invite logic, separated from the Server Action so it can be unit-tested with a mocked Supabase admin client. Three paths must be exercised: happy path, profile-insert-fails rollback, and duplicate-email pre-check.

The function signature takes a Supabase admin client instance (dependency injection) plus the input + the actor's `operator_id`. The Server Action (Task 9) constructs the real client and calls this function.

- [ ] **Step 1: Write the failing test.**

File `apps/portal/tests/lib/users/invite.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";

type Admin = ReturnType<typeof buildAdminMock>;

function buildAdminMock(opts: {
  existingProfile?: { id: string } | null;
  inviteResult?: { data: { user: { id: string } | null }; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingProfile ?? null,
    error: null,
  });
  const insert = vi
    .fn()
    .mockResolvedValue(opts.insertResult ?? { error: null });
  const eqEmail = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqEmail }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      // First call (pre-check) uses select; second call (insert) uses insert.
      return { select, insert };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const inviteUserByEmail = vi
    .fn()
    .mockResolvedValue(
      opts.inviteResult ?? {
        data: { user: { id: "user-new" } },
        error: null,
      },
    );
  const deleteUser = vi.fn().mockResolvedValue({ error: null });

  return {
    from,
    auth: { admin: { inviteUserByEmail, deleteUser } },
    _spies: { inviteUserByEmail, insert, deleteUser, maybeSingle },
  };
}

const REDIRECT_URL = "https://app.example.com/auth/callback?next=/onboarding";

afterEach(() => {
  vi.clearAllMocks();
});

describe("inviteUser", () => {
  it("returns an error if a profile with the same email already exists", async () => {
    const admin = buildAdminMock({
      existingProfile: { id: "user-existing" },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: { email: "x@example.com", full_name: "X", role: "AGENT" },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({
      ok: false,
      error: "A user with this email already exists.",
    });
    expect(admin._spies.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("invites and inserts profile on the happy path (AGENT gets twilio_identity)", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada Lovelace",
        role: "AGENT",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({ ok: true, userId: "user-new" });
    expect(admin._spies.inviteUserByEmail).toHaveBeenCalledWith(
      "ada@example.com",
      expect.objectContaining({
        redirectTo: REDIRECT_URL,
        data: { full_name: "Ada Lovelace", role: "AGENT" },
      }),
    );
    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-new",
        operator_id: "op-1",
        role: "AGENT",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        twilio_identity: "user-user-new".slice(0, 13),
        active: true,
      }),
    );
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });

  it("invites OWNER with twilio_identity null", async () => {
    const admin = buildAdminMock({}) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "owner@example.com",
        full_name: "Olive Owner",
        role: "OWNER",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(admin._spies.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "OWNER",
        twilio_identity: null,
      }),
    );
  });

  it("rolls back the auth user when profile insert fails", async () => {
    const admin = buildAdminMock({
      insertResult: { error: { message: "duplicate twilio_identity" } },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada",
        role: "ADMIN",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Failed to create profile/);
    }
    expect(admin._spies.deleteUser).toHaveBeenCalledWith("user-new");
  });

  it("returns the Supabase invite error when invitation fails", async () => {
    const admin = buildAdminMock({
      inviteResult: {
        data: { user: null },
        error: { message: "rate limit exceeded" },
      },
    }) as Admin;
    const { inviteUser } = await import("@/lib/users/invite");

    const result = await inviteUser({
      admin: admin as never,
      operatorId: "op-1",
      input: {
        email: "ada@example.com",
        full_name: "Ada",
        role: "ADMIN",
      },
      redirectTo: REDIRECT_URL,
    });

    expect(result).toEqual({
      ok: false,
      error: "Failed to send invitation: rate limit exceeded",
    });
    expect(admin._spies.insert).not.toHaveBeenCalled();
    expect(admin._spies.deleteUser).not.toHaveBeenCalled();
  });
});
```

Note: `twilio_identity` in the happy-path expectation is `"user-user-new".slice(0, 13)` = `"user-user-new"` (13 chars). The implementation generates `user-${userId.slice(0, 8)}` — when the test userId is `"user-new"` (8 chars), `slice(0,8)` returns `"user-new"`, so the identity is `"user-user-new"`. The test reuses `.slice(0, 13)` purely to be explicit about the expected concatenation.

- [ ] **Step 2: Run the test to verify it fails.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/invite.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/users/invite'`.

- [ ] **Step 3: Write the implementation.**

File `apps/portal/lib/users/invite.ts`:
```ts
// Core invite logic. Pure of Next.js — accepts a Supabase admin client and
// returns a discriminated result. Wrapped by inviteUserAction (Server Action).
//
// Sequence:
//   1. Pre-check: refuse if a profile with this email already exists in the
//      operator (case-insensitive email match).
//   2. Call auth.admin.inviteUserByEmail (creates auth.users + emails the link).
//   3. Insert into profiles with the new user's id + role-appropriate
//      twilio_identity.
//   4. If profile insert fails, call auth.admin.deleteUser to roll back so we
//      don't strand an auth user without a profile.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role } from "@lc/shared";

export type InviteInput = {
  email: string;
  full_name: string;
  role: Role;
};

export type InviteResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

type Args = {
  admin: SupabaseClient<Database>;
  operatorId: string;
  input: InviteInput;
  redirectTo: string;
};

function twilioIdentityFor(role: Role, userId: string): string | null {
  if (role === "OWNER") return null;
  return `user-${userId.slice(0, 8)}`;
}

export async function inviteUser(args: Args): Promise<InviteResult> {
  const email = args.input.email.trim().toLowerCase();

  // 1. Pre-check existing profile.
  const { data: existing } = await args.admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: "A user with this email already exists.",
    };
  }

  // 2. Invite via Supabase Auth.
  const { data: invited, error: inviteError } =
    await args.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: args.redirectTo,
      data: {
        full_name: args.input.full_name,
        role: args.input.role,
      },
    });

  if (inviteError || !invited?.user) {
    const message = inviteError?.message ?? "unknown error";
    return {
      ok: false,
      error: `Failed to send invitation: ${message}`,
    };
  }

  const newUserId = invited.user.id;

  // 3. Insert profile.
  const { error: insertError } = await args.admin.from("profiles").insert({
    id: newUserId,
    operator_id: args.operatorId,
    role: args.input.role,
    full_name: args.input.full_name,
    email,
    twilio_identity: twilioIdentityFor(args.input.role, newUserId),
    status: "OFFLINE",
    active: true,
  });

  if (insertError) {
    // 4. Roll back the auth user so the operator can retry cleanly.
    await args.admin.auth.admin.deleteUser(newUserId);
    return {
      ok: false,
      error: `Failed to create profile: ${insertError.message}`,
    };
  }

  return { ok: true, userId: newUserId };
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
pnpm --filter @lc/portal test -- tests/lib/users/invite.test.ts
```

Expected: PASS — all five `it` blocks green.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/users/invite.ts apps/portal/tests/lib/users/invite.test.ts
git commit -m "feat(portal): lib/users/invite — invite + profile insert + rollback with tests"
```

---

## Task 8: `/admin/users` page — Server Component fetch + table skeleton

**Files:**
- Create: `apps/portal/app/(admin)/admin/users/page.tsx`
- Create: `apps/portal/app/(admin)/admin/users/users-table.tsx`

The page is a Server Component that fetches all profiles in the current admin's operator and passes them as props to the Client Component table. No mutations yet — those land in Tasks 9–11 once `actions.ts` exists.

- [ ] **Step 1: Create the page.**

File `apps/portal/app/(admin)/admin/users/page.tsx`:
```tsx
import { createServerClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: users, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, role, status, active, last_seen_at, created_at",
    )
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Users</h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage admins, agents, and owners in your operator.
          </p>
        </div>
      </header>

      <UsersTable users={users ?? []} actorId={actor.id} />
    </div>
  );
}
```

- [ ] **Step 2: Create the Client Component table skeleton.**

File `apps/portal/app/(admin)/admin/users/users-table.tsx`:
```tsx
"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: "ADMIN" | "AGENT" | "OWNER";
  status: "AVAILABLE" | "ON_CALL" | "OFFLINE";
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

type Props = {
  readonly users: UserRow[];
  readonly actorId: string;
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function UsersTable({ users, actorId: _actorId }: Props) {
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <UserRound className="h-10 w-10 text-text-muted/40" />
        <p className="text-sm font-medium text-foreground">No users yet</p>
        <p className="text-xs text-text-muted">
          Invite your first user to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium text-foreground">
                  {u.full_name}
                </TableCell>
                <TableCell className="text-text-muted">{u.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{u.role}</Badge>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-xs">
                    <span
                      className={
                        u.status === "AVAILABLE"
                          ? "h-2 w-2 rounded-full bg-green-500"
                          : u.status === "ON_CALL"
                            ? "h-2 w-2 rounded-full bg-amber-500"
                            : "h-2 w-2 rounded-full bg-gray-300"
                      }
                    />
                    {u.status}
                  </span>
                </TableCell>
                <TableCell>{u.active ? "Yes" : "No"}</TableCell>
                <TableCell className="text-text-muted">
                  {relative(u.created_at)}
                </TableCell>
                <TableCell className="text-right text-text-muted">
                  {/* Actions menu added in Task 10 */}—
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + visit /admin/users in dev (optional).**

```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS. The page now renders the seeded admin row when you sign in (full smoke runs in Task 13).

- [ ] **Step 4: Commit.**

```bash
git add "apps/portal/app/(admin)/admin/users/page.tsx" \
        "apps/portal/app/(admin)/admin/users/users-table.tsx"
git commit -m "feat(portal): /admin/users page + table skeleton (read-only)"
```

---

## Task 9: Invite Dialog + `inviteUserAction`

**Files:**
- Create: `apps/portal/app/(admin)/admin/users/actions.ts`
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx`

Wire the Invite button + Dialog to a Server Action that delegates to the tested `inviteUser` helper. Audit-log the invitation, revalidate the page, and toast on success/failure.

- [ ] **Step 1: Create the actions file with the invite action.**

File `apps/portal/app/(admin)/admin/users/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/require-role";
import { inviteUser } from "@/lib/users/invite";
import {
  validateEmail,
  validateFullName,
  validateRole,
} from "@/lib/users/validate";
import { env } from "@/lib/env";
import type { Role } from "@lc/shared";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function inviteUserAction(input: {
  email: string;
  full_name: string;
  role: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const emailError = validateEmail(input.email);
  if (emailError) return { ok: false, error: emailError };

  const nameError = validateFullName(input.full_name);
  if (nameError) return { ok: false, error: nameError };

  const roleError = validateRole(input.role);
  if (roleError) return { ok: false, error: roleError };

  const admin = createAdminClient();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const result = await inviteUser({
    admin,
    operatorId: actor.operator_id,
    input: {
      email: input.email.trim().toLowerCase(),
      full_name: input.full_name.trim(),
      role: input.role as Role,
    },
    redirectTo: `${appUrl}/auth/callback?next=/onboarding`,
  });

  if (!result.ok) return result;

  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.invited",
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

Note: `createServerClient` is imported but not used in this task. Leave the import — Task 10 and 11 add actions that use it. (If lint complains about unused imports, remove and re-add later. Easier: keep it and add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` if needed, or just import it inline in those tasks. Cleanest: drop the import now and re-add in Task 10 — adjust accordingly.)

To avoid the lint dance, **omit `createServerClient` from this task's imports**. Re-add it at the top of `actions.ts` in Task 10.

- [ ] **Step 2: Wire the Invite Dialog into `users-table.tsx`.**

Replace `apps/portal/app/(admin)/admin/users/users-table.tsx` with the version below — it adds an "Invite user" button that opens a Dialog whose form calls `inviteUserAction`.

File `apps/portal/app/(admin)/admin/users/users-table.tsx` (full replacement):
```tsx
"use client";

import { useState, useTransition } from "react";
import { UserRound, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { inviteUserAction } from "./actions";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: "ADMIN" | "AGENT" | "OWNER";
  status: "AVAILABLE" | "ON_CALL" | "OFFLINE";
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

type Props = {
  readonly users: UserRow[];
  readonly actorId: string;
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await inviteUserAction({
        email: String(formData.get("email") ?? ""),
        full_name: String(formData.get("full_name") ?? ""),
        role: String(formData.get("role") ?? ""),
      });

      if (result.ok) {
        toast.success("Invitation sent");
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
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email with a link to set their password.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              name="full_name"
              type="text"
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select name="role" defaultValue="AGENT">
              <SelectTrigger id="invite-role">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersTable({ users, actorId: _actorId }: Props) {
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <InviteDialog />
      </div>

      {users.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <UserRound className="h-10 w-10 text-text-muted/40" />
          <p className="text-sm font-medium text-foreground">No users yet</p>
          <p className="text-xs text-text-muted">
            Invite your first user to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium text-foreground">
                    {u.full_name}
                  </TableCell>
                  <TableCell className="text-text-muted">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span
                        className={
                          u.status === "AVAILABLE"
                            ? "h-2 w-2 rounded-full bg-green-500"
                            : u.status === "ON_CALL"
                              ? "h-2 w-2 rounded-full bg-amber-500"
                              : "h-2 w-2 rounded-full bg-gray-300"
                        }
                      />
                      {u.status}
                    </span>
                  </TableCell>
                  <TableCell>{u.active ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-text-muted">
                    {relative(u.created_at)}
                  </TableCell>
                  <TableCell className="text-right text-text-muted">
                    {/* Per-row actions added in Task 10 */}—
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint + test.**

```bash
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
pnpm --filter @lc/portal test
```

Expected: all PASS. The invite Dialog is wired but no end-to-end test runs yet (Task 13 smoke).

- [ ] **Step 4: Commit.**

```bash
git add "apps/portal/app/(admin)/admin/users/actions.ts" \
        "apps/portal/app/(admin)/admin/users/users-table.tsx"
git commit -m "feat(portal): invite Dialog + inviteUserAction with audit log"
```

---

## Task 10: Edit Sheet + `updateUserAction`

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/actions.ts`
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx`

The Edit Sheet lets an admin change `full_name`, `role`, and `active` on a target user. When the actor is editing themselves, `role` and `active` controls are disabled in the UI (the Server Action also rejects them via guards). Each field that actually changed writes its own audit row.

- [ ] **Step 1: Append `updateUserAction` to `actions.ts`.**

Open `apps/portal/app/(admin)/admin/users/actions.ts`. Add the `createServerClient` import at the top (alongside the existing imports):

```ts
import { createServerClient } from "@/lib/supabase/server";
```

Then append below `inviteUserAction`:

```ts
import {
  assertNotSelfDemote,
  assertNotSelfDeactivate,
  type UserPatch,
} from "@/lib/users/guards";

type UpdateInput = {
  targetUserId: string;
  full_name?: string;
  role?: string;
  active?: boolean;
};

export async function updateUserAction(
  input: UpdateInput,
): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  // Normalize role to the Role union if present.
  const patch: UserPatch = {};
  if (input.full_name !== undefined) {
    const nameError = validateFullName(input.full_name);
    if (nameError) return { ok: false, error: nameError };
    patch.full_name = input.full_name.trim();
  }
  if (input.role !== undefined) {
    const roleError = validateRole(input.role);
    if (roleError) return { ok: false, error: roleError };
    patch.role = input.role as Role;
  }
  if (input.active !== undefined) {
    patch.active = input.active;
  }

  // Self-edit guards (server-side enforcement).
  const demoteError = assertNotSelfDemote({
    actorId: actor.id,
    targetId: input.targetUserId,
    patch,
  });
  if (demoteError) return { ok: false, error: demoteError };

  const deactivateError = assertNotSelfDeactivate({
    actorId: actor.id,
    targetId: input.targetUserId,
    patch,
  });
  if (deactivateError) return { ok: false, error: deactivateError };

  // Confirm target is in the same operator before mutating.
  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("profiles")
    .select(
      "id, operator_id, full_name, role, active, twilio_identity",
    )
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  // Build the update payload + figure out which fields actually changed.
  const updates: Record<string, unknown> = {};
  const auditEvents: Array<{ action: string; details: unknown }> = [];

  if (
    patch.full_name !== undefined &&
    patch.full_name !== target.full_name
  ) {
    updates.full_name = patch.full_name;
    auditEvents.push({
      action: "user.profile_edited",
      details: {
        field: "full_name",
        from: target.full_name,
        to: patch.full_name,
      },
    });
  }

  if (patch.role !== undefined && patch.role !== target.role) {
    updates.role = patch.role;
    // OWNER → AGENT/ADMIN: assign twilio_identity if missing.
    if (
      target.twilio_identity === null &&
      (patch.role === "AGENT" || patch.role === "ADMIN")
    ) {
      updates.twilio_identity = `user-${target.id.slice(0, 8)}`;
    }
    auditEvents.push({
      action: "user.role_changed",
      details: { from: target.role, to: patch.role },
    });
  }

  if (patch.active !== undefined && patch.active !== target.active) {
    updates.active = patch.active;
    auditEvents.push({
      action: "user.active_toggled",
      details: { from: target.active, to: patch.active },
    });
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true }; // No-op.
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update(updates)
    .eq("id", input.targetUserId);

  if (error) {
    return { ok: false, error: `Failed to update user: ${error.message}` };
  }

  for (const evt of auditEvents) {
    await logAuditEvent({
      actorUserId: actor.id,
      action: evt.action,
      entityType: "user",
      entityId: input.targetUserId,
      details: evt.details as never,
    });
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
```

- [ ] **Step 2: Add the Edit Sheet + per-row actions menu in `users-table.tsx`.**

Open `apps/portal/app/(admin)/admin/users/users-table.tsx`. Add these imports at the top alongside the existing ones:

```tsx
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { updateUserAction } from "./actions";
```

Add the `EditSheet` component (place above the `UsersTable` export, below `InviteDialog`):

```tsx
function EditSheet(props: {
  user: UserRow;
  actorId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isSelf = props.user.id === props.actorId;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState(props.user.full_name);
  const [role, setRole] = useState<UserRow["role"]>(props.user.role);
  const [active, setActive] = useState(props.user.active);

  function onSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateUserAction({
        targetUserId: props.user.id,
        full_name: fullName,
        role: isSelf ? undefined : role,
        active: isSelf ? undefined : active,
      });

      if (result.ok) {
        toast.success("User updated");
        props.onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit {props.user.full_name}</SheetTitle>
          <SheetDescription>
            {isSelf
              ? "You can edit your name. Role and active status are locked for your own account."
              : "Update the user's name, role, or active status."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Full name</Label>
            <Input
              id="edit-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-role">Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRow["role"])}
              disabled={isSelf}
            >
              <SelectTrigger id="edit-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="AGENT">Agent</SelectItem>
                <SelectItem value="OWNER">Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-active" className="flex flex-col gap-0.5">
              <span>Active</span>
              <span className="text-xs text-text-muted">
                Inactive users can&apos;t sign in.
              </span>
            </Label>
            <Switch
              id="edit-active"
              checked={active}
              onCheckedChange={setActive}
              disabled={isSelf}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

Then update the actions cell in the table body to render the menu. Replace this block:

```tsx
<TableCell className="text-right text-text-muted">
  {/* Per-row actions added in Task 10 */}—
</TableCell>
```

with:

```tsx
<TableCell className="text-right">
  <RowActions user={u} actorId={_actorId} />
</TableCell>
```

Rename `_actorId: _actorId` back to `actorId` in the `Props` destructure (we're using it now):

```tsx
export function UsersTable({ users, actorId }: Props) {
```

And pass `actorId={actorId}` to `RowActions` accordingly.

Finally, add the `RowActions` component (above `UsersTable`):

```tsx
function RowActions({ user, actorId }: { user: UserRow; actorId: string }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {/* Deactivate + Delete added in Task 11 */}
        </DropdownMenuContent>
      </DropdownMenu>
      <EditSheet
        user={user}
        actorId={actorId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint + test.**

```bash
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
pnpm --filter @lc/portal test
```

Expected: all PASS.

- [ ] **Step 4: Commit.**

```bash
git add "apps/portal/app/(admin)/admin/users/actions.ts" \
        "apps/portal/app/(admin)/admin/users/users-table.tsx"
git commit -m "feat(portal): edit user sheet + updateUserAction with per-field audit"
```

---

## Task 11: Deactivate + hard-delete escape hatch

**Files:**
- Modify: `apps/portal/app/(admin)/admin/users/actions.ts`
- Modify: `apps/portal/app/(admin)/admin/users/users-table.tsx`

Two more per-row actions. Deactivate/Reactivate is a one-click with an AlertDialog confirm. Hard-delete is the destructive escape hatch — the admin must type the target's email exactly to enable the destructive button. Both actions are hidden from the actor's own row.

- [ ] **Step 1: Append `hardDeleteUserAction` to `actions.ts`.**

Add this import at the top of `apps/portal/app/(admin)/admin/users/actions.ts` (alongside the existing guards import — extend it):

```ts
import {
  assertNotSelfDemote,
  assertNotSelfDeactivate,
  assertNotSelfDelete,
  type UserPatch,
} from "@/lib/users/guards";
```

Then append below `updateUserAction`:

```ts
export async function hardDeleteUserAction(input: {
  targetUserId: string;
  confirmEmail: string;
}): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const guardError = assertNotSelfDelete({
    actorId: actor.id,
    targetId: input.targetUserId,
  });
  if (guardError) return { ok: false, error: guardError };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, operator_id, email, full_name")
    .eq("id", input.targetUserId)
    .maybeSingle();

  if (!target || target.operator_id !== actor.operator_id) {
    return { ok: false, error: "User not found in your operator." };
  }

  if (input.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
    return {
      ok: false,
      error: "Email confirmation did not match. Deletion aborted.",
    };
  }

  // Audit BEFORE delete so the actor's profile + the target snapshot exist.
  // Migration 0003 nulls actor_user_id only on actor deletion; this row
  // describes the target's deletion, so it survives intact.
  await logAuditEvent({
    actorUserId: actor.id,
    action: "user.deleted",
    entityType: "user",
    entityId: target.id,
    details: { email: target.email, full_name: target.full_name },
  });

  // Hard delete: auth.users → cascades to profiles via on delete cascade.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(input.targetUserId);

  if (error) {
    return { ok: false, error: `Failed to delete user: ${error.message}` };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
```

- [ ] **Step 2: Add the deactivate + delete UI in `users-table.tsx`.**

Open `apps/portal/app/(admin)/admin/users/users-table.tsx`. Add these imports alongside the existing ones:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hardDeleteUserAction } from "./actions";
```

Replace the existing `RowActions` component with:

```tsx
function RowActions({ user, actorId }: { user: UserRow; actorId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmEmail, setConfirmEmail] = useState("");
  const isSelf = user.id === actorId;

  function onToggleActive() {
    startTransition(async () => {
      const result = await updateUserAction({
        targetUserId: user.id,
        active: !user.active,
      });
      if (result.ok) {
        toast.success(user.active ? "User deactivated" : "User reactivated");
        setDeactivateOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function onHardDelete() {
    startTransition(async () => {
      const result = await hardDeleteUserAction({
        targetUserId: user.id,
        confirmEmail,
      });
      if (result.ok) {
        toast.success("User deleted permanently");
        setDeleteOpen(false);
        setConfirmEmail("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {!isSelf ? (
            <DropdownMenuItem onSelect={() => setDeactivateOpen(true)}>
              {user.active ? "Deactivate" : "Reactivate"}
            </DropdownMenuItem>
          ) : null}
          {!isSelf ? (
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="text-destructive focus:text-destructive"
            >
              Delete permanently
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditSheet
        user={user}
        actorId={actorId}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {user.active ? "Deactivate" : "Reactivate"} {user.full_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {user.active
                ? "They won't be able to sign in until reactivated."
                : "They'll be able to sign in again immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onToggleActive} disabled={pending}>
              {pending
                ? "Working…"
                : user.active
                  ? "Deactivate"
                  : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setConfirmEmail("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {user.full_name} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This wipes the user from Supabase Auth and the profile. Audit
              rows they authored will keep the action but lose the actor
              identity. Type their email to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={user.email}
            autoComplete="off"
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onHardDelete}
              disabled={
                pending ||
                confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 3: Typecheck + lint + test.**

```bash
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
pnpm --filter @lc/portal test
```

Expected: all PASS.

- [ ] **Step 4: Commit.**

```bash
git add "apps/portal/app/(admin)/admin/users/actions.ts" \
        "apps/portal/app/(admin)/admin/users/users-table.tsx"
git commit -m "feat(portal): deactivate + hard-delete escape hatch with email confirm"
```

---

## Task 12: `/onboarding` page + action

**Files:**
- Create: `apps/portal/app/(auth)/onboarding/page.tsx`
- Create: `apps/portal/app/(auth)/onboarding/actions.ts`

The user lands here after PKCE exchange at `/auth/callback`. They have a session. The form shows password + confirm + an editable, prefilled `full_name`. Submit: `updateUser({ password })`, optionally update `profiles.full_name` if changed, audit `user.onboarded`, redirect to `/` (which routes to their role dashboard).

- [ ] **Step 1: Create the Server Action.**

File `apps/portal/app/(auth)/onboarding/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  validateFullName,
  validatePassword,
} from "@/lib/users/validate";

export type OnboardingState = {
  error: string | null;
};

export async function onboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  const pwError = validatePassword(password);
  if (pwError) return { error: pwError };
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }
  const nameError = validateFullName(fullName);
  if (nameError) return { error: nameError };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error: updateAuthError } = await supabase.auth.updateUser({
    password,
  });
  if (updateAuthError) {
    return { error: "Failed to set password. Please try again." };
  }

  // Read the current profile name so we know whether the user changed it.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const nameChanged = profile != null && profile.full_name !== fullName;

  if (nameChanged) {
    const { error: nameUpdateError } = await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    if (nameUpdateError) {
      return {
        error: "Password saved, but couldn't update your name. Try again from your account page.",
      };
    }
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "user.onboarded",
    entityType: "user",
    entityId: user.id,
    details: { name_changed: nameChanged },
  });

  redirect("/");
}
```

- [ ] **Step 2: Create the page.**

File `apps/portal/app/(auth)/onboarding/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import OnboardingForm from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return <OnboardingForm defaultName={profile?.full_name ?? ""} />;
}
```

- [ ] **Step 3: Create the Client Component form.**

File `apps/portal/app/(auth)/onboarding/onboarding-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardingAction, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export default function OnboardingForm({
  defaultName,
}: {
  readonly defaultName: string;
}) {
  const [state, formAction, pending] = useActionState(
    onboardingAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Welcome to Lobby Connect
        </h1>
        <p className="text-sm text-text-muted">
          Set a password and confirm your name to finish creating your
          account.
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-name">Full name</Label>
        <Input
          id="onboard-name"
          name="full_name"
          type="text"
          required
          defaultValue={defaultName}
          autoComplete="name"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-password">New password</Label>
        <Input
          id="onboard-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboard-confirm">Confirm password</Label>
        <Input
          id="onboard-confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Finish setup"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Typecheck + lint + test.**

```bash
pnpm --filter @lc/portal typecheck
pnpm --filter @lc/portal lint
pnpm --filter @lc/portal test
```

Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add "apps/portal/app/(auth)/onboarding"
git commit -m "feat(portal): /onboarding page + action with audit log"
```

---

## Task 13: Final verification + tag

**Files:** none — verification + tagging only.

- [ ] **Step 1: Full repo lint + typecheck + test from the root.**

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three PASS.

- [ ] **Step 2: Build the portal.**

```bash
pnpm --filter @lc/portal build
```

Expected: PASS, or fail with "Missing required environment variable" if `.env.local` isn't populated — that's an acceptable CI-environment failure for this plan, same as Plan 3.

- [ ] **Step 3: Manual smoke (Docker + local Supabase required).**

Prerequisites: Docker Desktop running, `pnpm supabase:start` complete, `pnpm exec supabase db reset` complete (migrations 0001 + 0002 + 0003 applied + seed), `apps/portal/.env.local` populated.

Run `pnpm dev:portal`. Wait for "Ready".

**Forgot password reachability (proves Task 1):**
1. Visit `http://localhost:3000/sign-in` while signed out → click "Forgot password?" → expect `/forgot-password` to render (previously redirected to `/sign-in`).

**Admin shell + users list:**
2. Sign in as `admin@lobbyconnect.local` / `localdev123` → land on `/admin` overview.
3. Confirm sidebar shows Logo, Users, Properties, Assignments, Settings. Sidebar collapses to icons; hover-expand shows labels.
4. Click Users → `/admin/users` → table shows the seeded admin row (role ADMIN, status OFFLINE, active Yes).

**Invite flow:**
5. Click "Invite user" → fill `agent@test.local` / `Agent Smith` / Agent → Submit.
6. Confirm toast "Invitation sent". Table refreshes; new row appears with role AGENT, status OFFLINE, active Yes.
7. Open Inbucket at `http://localhost:54324` → find the invitation email → click the link.
8. Browser navigates through `/auth/callback?code=...` → lands on `/onboarding` with a centered card.
9. Confirm `full_name` is prefilled to "Agent Smith". Set password `agent-pass-1`, confirm `agent-pass-1`, edit name to "Agent S. Smith" → Submit.
10. Expect redirect to `/` → `/agent` (placeholder agent dashboard).
11. In Supabase Studio (`http://localhost:54323`) → `audit_logs` → expect rows: `user.invited`, `user.onboarded` with `details.name_changed = true`.

**Edit + role change + twilio_identity backfill:**
12. Sign out → sign back in as admin → `/admin/users` → click `…` on the new agent row → Edit.
13. Change role to OWNER → Save → confirm toast "User updated". Inspect `profiles` row in Studio: `role=OWNER`, `twilio_identity` still set (we don't drop it).
14. Edit again, change role back to AGENT → Save. Inspect: `twilio_identity` unchanged (still set since it wasn't null).
15. Audit log shows two `user.role_changed` rows.

**Self-edit guard:**
16. On the admin's own row, open Edit Sheet → confirm role + active fields are disabled.
17. Confirm the `…` menu on the admin's row shows only Edit (no Deactivate, no Delete permanently).

**Deactivate + reactivate:**
18. On the agent row, click `…` → Deactivate → confirm → expect toast "User deactivated", `active = No` in the table.
19. Repeat with Reactivate → `active = Yes`.

**Hard delete:**
20. On the agent row, click `…` → Delete permanently → AlertDialog opens. Type a wrong email → destructive button stays disabled. Type the correct email → button activates → click.
21. Expect toast "User deleted permanently". Row gone. In Studio: `auth.users` row gone, `profiles` row gone (cascade). `audit_logs.user.deleted` row exists. Old `user.invited` and `user.onboarded` rows authored by anyone still exist; if the deleted user authored any (they did: `user.onboarded`), their `actor_user_id` is now NULL (proves migration 0003).

**Sign out:**
22. Click profile menu in header → Sign out → land on `/sign-in`.

If any step fails, fix in place before tagging.

- [ ] **Step 4: Tag the plan complete.**

```bash
git tag plan-04a-admin-users-complete
git push origin main --tags
```

- [ ] **Step 5: Update the project-status memory.**

Update `/Users/kumarthakkar/.claude/projects/-Users-kumarthakkar-Documents-Claude-Projects-Lobby-Connect/memory/project-status.md` so the **Plan 3** section is superseded by **Plan 4a**, recording:
- Tag pushed: `plan-04a-admin-users-complete`
- What was built (shell, users CRUD, invite + onboarding, migration 0003, middleware fix)
- Manual smoke status (completed vs deferred)
- Next plan: **Plan 4b — Properties CRUD**.

---

## Self-review checklist

Before declaring the plan ready, the writer ran these checks:

**Spec coverage.** Each in-scope section of `docs/specs/2026-05-28-admin-users-invite-design.md` maps to at least one task:

| Spec § | Covered by |
|---|---|
| §3.1 Scope split into 4a/4b/4c | Roadmap table |
| §3.2 Full layout shell | Task 4 |
| §3.3 Block self-demote/deactivate | Task 6 (guards) + Task 10 (UI disable + server enforcement) + Task 11 (delete guard + UI hide) |
| §3.4 Soft-delete primary, hard-delete escape hatch | Task 10 (deactivate via updateUserAction) + Task 11 (hard delete + AlertDialog with email confirm) |
| §3.5 `audit_logs.actor_user_id` ON DELETE SET NULL | Task 2 (migration 0003) + Task 13 step 21 (verifies behavior) |
| §3.6 Pre-create profile + rollback | Task 7 (TDD) + Task 9 (wiring) |
| §3.7 Onboarding password + editable name | Task 12 |
| §3.8 Invite collects email + full_name + role | Task 9 |
| §3.9 Middleware matcher fix | Task 1 |

**Placeholder scan.** No "TBD" / "appropriate error handling" / "fill in" / "..." inside code steps. Comments in code that say "added in Task N" are intentional (they're the actual file contents at that point in the build sequence, not placeholders the engineer is meant to fill).

**Type consistency.**
- `UserRow` shape in `users-table.tsx` matches the Server Component's `select(...)` list in `page.tsx`.
- `UserPatch` from `guards.ts` (`full_name`, `role`, `active`) matches the patch field set used in `updateUserAction`.
- `inviteUser` return type (`{ ok: true; userId: string } | { ok: false; error: string }`) is referenced consistently in the test and the action.
- `ActionResult` from `actions.ts` (`{ ok: true } | { ok: false; error: string }`) is consumed by every consumer in `users-table.tsx`.
- `Role` is imported from `@lc/shared` everywhere it's used as a type.

**Known soft spots.**
- The `_actorId: _actorId` → `actorId` rename in Task 10 step 2 requires the engineer to track a renamed prop across the file. Called out explicitly in the step.
- Task 9 step 1 has a deliberate "do not import `createServerClient` yet" instruction to avoid a lint warning. Task 10 then adds the import. This is awkward but cheaper than disabling lint inline.
- Manual smoke step 13 says we don't drop `twilio_identity` when role moves to OWNER — that's deliberate (avoids breaking historic `calls.handled_by_user_id` lookups), matches the spec's "no twilio_identity rotation" non-goal, and is something to revisit in a later plan if needed.
