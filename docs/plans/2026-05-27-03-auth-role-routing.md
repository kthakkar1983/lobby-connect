# Auth & Role Routing Implementation Plan (Plan 3 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js auth gate so the portal is unreachable without a Supabase session, sign-in works against the seeded admin user, signed-in users land on a role-appropriate dashboard placeholder, and sign-in/sign-out emit audit log rows.

**Architecture:** Four Supabase clients (browser, server-component, middleware-context, service-role) wrapping `@supabase/ssr`'s cookie flow. A single `middleware.ts` at the portal root refreshes the auth cookie on every request and 302s to `/sign-in` when no session exists. The root `app/page.tsx` resolves the signed-in user's role and redirects to `/agent`, `/admin`, or `/owner`. Each role lives in its own route group (`app/(agent)/`, `app/(admin)/`, `app/(owner)/`) whose layout calls a shared `requireRole(...)` helper that double-checks role server-side and `redirect()`s on mismatch. Sign-in is a Server Action against `signInWithPassword`; sign-out is a POST route handler. Both emit `user.signed_in` / `user.signed_out` rows in `audit_logs` via the service-role client.

**Tech stack:**
- Next.js 15 App Router (already installed, Plan 1)
- `@supabase/ssr` ^0.5 + `@supabase/supabase-js` ^2.45 (new in this plan)
- React 19 Server Actions
- Vitest for unit tests (already configured, Plan 1)

**Scope callout — onboarding is deferred to Plan 4.** The spec (§ 6.1) describes a `/onboarding` page where invited users set their initial password. Because invitations are sent from the admin CRUD surface, and the only existing user (`admin@lobbyconnect.local`) already has a password from `seed.sql`, the onboarding flow belongs with Plan 4 (Admin CRUD). Plan 3 ships: sign-in, sign-out, forgot-password, and the update-password page (full password reset flow).

---

## Plan roadmap (you are here: Plan 3)

| # | Plan | Outputs |
|---|---|---|
| 1 | Foundation | Empty shell that boots, lints, tests, type-checks |
| 2 | Database & RLS | `0001_init.sql`, `0002_rls.sql`, `seed.sql`, hand-written TS types |
| **3** | **Auth & role routing** ← *this plan* | Supabase SSR clients, middleware gate, sign-in page, role-grouped layouts, audit on auth events |
| 4 | Admin CRUD | Properties, profiles, assignments, `admin_call_availability`, invite flow, onboarding page |
| 5 | Voice path & agent dashboard | Twilio webhooks, parallel-dial TwiML, softphone, call history |
| 6 | Owner portal | Mobile-first properties + recordings + kiosk message editing |
| 7 | Kiosk | K-01→K-04→K-08, Agora client, kiosk→portal API, agora token route |
| 8 | Observability | Sentry, `/status` page, `/audit` page, stale-OFFLINE cron |

---

## Pre-flight (one-time, do once before Task 1)

```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
git status                          # expect clean working tree on main
git describe --tags --abbrev=0      # expect plan-02-database-rls-complete
pnpm --version                      # expect 9.x
pnpm typecheck                      # expect pass
pnpm test                           # expect pass (portal smoke + kiosk smoke)
```

If any of these fails, fix before starting.

### Local Supabase setup (Docker is installed — do this once before Task 13)

```bash
# 1. Install the Supabase CLI (once per machine)
brew install supabase/tap/supabase

# 2. Start Docker Desktop (the app), then start the local Supabase stack:
pnpm supabase:start
#    First run takes ~2–3 minutes to pull images.
#    Subsequent runs: ~10s.
#    Output includes the local keys — copy them to apps/portal/.env.local:
#      NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
#      NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
#      SUPABASE_SERVICE_ROLE_KEY=<service_role key>

# 3. Apply migrations + seed (wipes local DB to a clean state):
pnpm exec supabase db reset
#    Runs all supabase/migrations/*.sql in order, then supabase/seed.sql.
#    After this, admin@lobbyconnect.local / localdev123 is ready.

# 4. Re-check keys anytime:
pnpm exec supabase status
```

Supabase Studio (local) is at **http://localhost:54323** — useful for inspecting rows during the smoke test.

**Supabase reachability is NOT required for code-level tasks 1–12.** The end-to-end manual smoke (Task 13) requires either local Supabase running (preferred now that Docker is available) or a linked remote project.

---

## Reference docs (open in a second tab)

- `docs/specs/2026-05-27-v1-architecture-design.md` — §6 (auth + RLS), §9 (UI baseline)
- `@supabase/ssr` cookbook: https://supabase.com/docs/guides/auth/server-side/nextjs
- Plan 2 — for the `Database` type shape and seed user credentials

**Seeded admin credentials (from `supabase/seed.sql`):**
- Email: `admin@lobbyconnect.local`
- Password: `localdev123`

---

## File map (what exists after this plan)

```
apps/portal/
├── middleware.ts                                ← Task 5 (new)
├── app/
│   ├── globals.css                              ← unchanged
│   ├── layout.tsx                               ← unchanged
│   ├── page.tsx                                 ← Task 8 (modified — role-based redirect)
│   ├── (auth)/
│   │   ├── layout.tsx                           ← Task 6 (new)
│   │   ├── sign-in/
│   │   │   ├── page.tsx                         ← Task 6 (new — includes "Forgot password?" link)
│   │   │   └── actions.ts                       ← Task 6 (new)
│   │   └── forgot-password/
│   │       ├── page.tsx                         ← Task 11 (new)
│   │       └── actions.ts                       ← Task 11 (new)
│   ├── (agent)/
│   │   ├── layout.tsx                           ← Task 9 (new)
│   │   └── agent/page.tsx                       ← Task 9 (new)
│   ├── (admin)/
│   │   ├── layout.tsx                           ← Task 9 (new)
│   │   └── admin/page.tsx                       ← Task 9 (new)
│   ├── (owner)/
│   │   ├── layout.tsx                           ← Task 9 (new)
│   │   └── owner/page.tsx                       ← Task 9 (new)
│   └── auth/
│       ├── callback/route.ts                    ← Task 10 (new — PKCE code exchange)
│       ├── signout/route.ts                     ← Task 7 (new)
│       └── update-password/
│           ├── page.tsx                         ← Task 12 (new)
│           └── actions.ts                       ← Task 12 (new)
├── lib/
│   ├── env.ts                                   ← Task 1 (new)
│   ├── supabase/
│   │   ├── client.ts                            ← Task 2 (new)
│   │   ├── server.ts                            ← Task 2 (new)
│   │   ├── middleware.ts                        ← Task 2 (new)
│   │   └── admin.ts                             ← Task 2 (new)
│   └── auth/
│       ├── require-role.ts                      ← Task 3 (new)
│       └── audit.ts                             ← Task 4 (new)
├── tests/
│   ├── smoke.test.ts                            ← unchanged
│   ├── lib/auth/require-role.test.ts            ← Task 3 (new)
│   └── lib/auth/audit.test.ts                   ← Task 4 (new)
└── package.json                                 ← Task 1 (modified — deps)
```

No shared package or kiosk changes in this plan.

---

## Task 1: Dependencies + typed env loader

**Files:**
- Modify: `apps/portal/package.json`
- Create: `apps/portal/lib/env.ts`

Adds the two Supabase libraries and a tiny env loader that throws a clear error if any required Supabase var is missing. The loader is the single place every Supabase client reads env from — no scattered `process.env.NEXT_PUBLIC_SUPABASE_URL!` non-null assertions.

- [ ] **Step 1: Install Supabase deps.**

Run:
```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm --filter @lc/portal add @supabase/ssr@^0.5.0 @supabase/supabase-js@^2.45.0
```

Expected: pnpm adds both packages, updates `apps/portal/package.json`, regenerates `pnpm-lock.yaml`.

- [ ] **Step 2: Verify install.**

Run:
```bash
pnpm typecheck
```

Expected: PASS (no usages of the new packages yet, just confirming deps installed cleanly).

- [ ] **Step 3: Create the env loader.**

File `apps/portal/lib/env.ts`:
```ts
// apps/portal/lib/env.ts
//
// Single source of truth for portal env vars. Throws at module load if a
// required var is missing, with a message naming the var. Never use
// `process.env.X!` directly anywhere else in the portal — import from here.

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in apps/portal/.env.local (see .env.example).`,
    );
  }
  return value;
}

function optional(value: string | undefined): string | undefined {
  if (!value || value.length === 0) return undefined;
  return value;
}

export const env = {
  // Public — exposed to browser bundle. Safe to ship.
  NEXT_PUBLIC_SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),

  // Server-only — never exposed. Read inside route handlers / server modules.
  SUPABASE_SERVICE_ROLE_KEY: required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ),

  NEXT_PUBLIC_APP_URL: optional(process.env.NEXT_PUBLIC_APP_URL),
} as const;

export type Env = typeof env;
```

- [ ] **Step 4: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/package.json apps/portal/lib/env.ts pnpm-lock.yaml
git commit -m "feat(portal): add @supabase/ssr + typed env loader"
```

---

## Task 2: Four Supabase clients

**Files:**
- Create: `apps/portal/lib/supabase/client.ts`
- Create: `apps/portal/lib/supabase/server.ts`
- Create: `apps/portal/lib/supabase/middleware.ts`
- Create: `apps/portal/lib/supabase/admin.ts`

Why four? Each runs in a different Next.js context with different cookie capabilities:

| Client | Runtime | Cookies | Auth scope | Used by |
|---|---|---|---|---|
| `client.ts` | Browser | `document.cookie` via `@supabase/ssr` | Authenticated user | Client Components |
| `server.ts` | Server Components / Server Actions | `next/headers` cookies (read-only in Server Components, writeable in Actions) | Authenticated user | Server Components, Server Actions |
| `middleware.ts` | Edge middleware | `NextRequest`/`NextResponse` cookies | Authenticated user (refreshing session) | `middleware.ts` |
| `admin.ts` | Server (Node runtime) | No cookies | Service role — bypasses RLS | Webhooks, audit writes, future admin invite route |

The first three use the anon key; only `admin.ts` uses the service-role key.

- [ ] **Step 1: Create the browser client.**

File `apps/portal/lib/supabase/client.ts`:
```ts
// apps/portal/lib/supabase/client.ts
//
// Browser-side Supabase client. Use ONLY inside Client Components
// ('use client'). Reads the cookie that the server set during sign-in.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 2: Create the server (Server-Component / Action) client.**

File `apps/portal/lib/supabase/server.ts`:
```ts
// apps/portal/lib/supabase/server.ts
//
// Server-side Supabase client for Server Components, Server Actions, and
// Route Handlers. Reads cookies from next/headers. Writes silently succeed
// in Server Components (cookies are read-only there) and persist in Server
// Actions / Route Handlers.

import { createServerClient as createSSRServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export async function createServerClient() {
  const cookieStore = await cookies();
  return createSSRServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session cookie on every request, so this is fine.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Create the middleware client builder.**

File `apps/portal/lib/supabase/middleware.ts`:
```ts
// apps/portal/lib/supabase/middleware.ts
//
// Supabase client for Next.js middleware. Pairs request and response cookies
// so the session cookie is refreshed and forwarded on every request.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export function createMiddlewareClient(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, response };
}
```

- [ ] **Step 4: Create the service-role admin client.**

File `apps/portal/lib/supabase/admin.ts`:
```ts
// apps/portal/lib/supabase/admin.ts
//
// Service-role Supabase client. Bypasses RLS. Use ONLY inside server-only
// code paths that must escape user scoping: Twilio webhooks, audit log
// writes, admin-invite routes. Never import from a Client Component.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@lc/shared";
import { env } from "@/lib/env";

export function createAdminClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
```

- [ ] **Step 5: Install the `server-only` dep used by `admin.ts`.**

Run:
```bash
pnpm --filter @lc/portal add server-only@^0.0.1
```

Expected: pnpm adds the package. (`server-only` is a tiny marker package by the Next.js team that throws at build time if a server-only module is imported from a client bundle.)

- [ ] **Step 6: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/portal/lib/supabase apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(portal): four Supabase clients (browser, server, middleware, admin)"
```

---

## Task 3: `requireRole` helper (TDD)

**Files:**
- Test: `apps/portal/tests/lib/auth/require-role.test.ts`
- Create: `apps/portal/lib/auth/require-role.ts`

`requireRole(role)` is called from every role-grouped layout. It fetches the current user's profile via the server client and returns it on match, or `redirect()`s to `/sign-in` on no session, or to `/` on wrong role (which then redirects to the user's actual role group via Task 8).

We test it by mocking the server client and the `redirect` function — pure unit tests, no Supabase round-trip.

- [ ] **Step 1: Write the failing test.**

File `apps/portal/tests/lib/auth/require-role.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`__redirect__:${url}`);
});

const getUserMock = vi.fn();
const fromMock = vi.fn();
const singleMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function mockProfileQuery(result: {
  data: { id: string; role: "AGENT" | "ADMIN" | "OWNER"; operator_id: string; active: boolean } | null;
  error: { message: string } | null;
}) {
  singleMock.mockResolvedValueOnce(result);
  fromMock.mockReturnValueOnce({
    select: () => ({
      eq: () => ({
        maybeSingle: singleMock,
      }),
    }),
  });
}

describe("requireRole", () => {
  it("redirects to /sign-in when there is no session", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/sign-in");
    expect(redirectMock).toHaveBeenCalledWith("/sign-in");
  });

  it("redirects to / when the user has a different role", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "AGENT", operator_id: "op-1", active: true },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("redirects to /sign-in when the profile is inactive", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "ADMIN", operator_id: "op-1", active: false },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    await expect(requireRole("ADMIN")).rejects.toThrow("__redirect__:/sign-in");
  });

  it("returns the profile when role matches and user is active", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockProfileQuery({
      data: { id: "user-1", role: "ADMIN", operator_id: "op-1", active: true },
      error: null,
    });
    const { requireRole } = await import("@/lib/auth/require-role");

    const profile = await requireRole("ADMIN");
    expect(profile).toEqual({
      id: "user-1",
      role: "ADMIN",
      operator_id: "op-1",
      active: true,
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run:
```bash
pnpm --filter @lc/portal test -- tests/lib/auth/require-role.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/auth/require-role'".

- [ ] **Step 3: Write the implementation.**

File `apps/portal/lib/auth/require-role.ts`:
```ts
// apps/portal/lib/auth/require-role.ts
//
// Server-side role gate. Call from a Server Component layout to enforce that
// the current user has the given role. Redirects on mismatch — never returns
// to the caller in that case.
//
// Defense in depth: middleware.ts handles the "no session at all" case for
// every route, but requireRole repeats the session check so layouts are safe
// in isolation (e.g., if the middleware matcher ever changes).

import { redirect } from "next/navigation";
import type { Role } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";

export type RequiredProfile = {
  id: string;
  role: Role;
  operator_id: string;
  active: boolean;
};

export async function requireRole(role: Role): Promise<RequiredProfile> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, operator_id, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  if (profile.role !== role) {
    redirect("/");
  }

  return profile;
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run:
```bash
pnpm --filter @lc/portal test -- tests/lib/auth/require-role.test.ts
```

Expected: PASS — all four `it` blocks green.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/auth/require-role.ts apps/portal/tests/lib/auth/require-role.test.ts
git commit -m "feat(portal): requireRole server-side role gate with unit tests"
```

---

## Task 4: Audit log helpers (TDD)

**Files:**
- Test: `apps/portal/tests/lib/auth/audit.test.ts`
- Create: `apps/portal/lib/auth/audit.ts`

Three helpers:
- `logAuditEvent(args)` — low-level insert (used by future plans for `user.invited`, `property.created`, etc.)
- `logSignIn(userId)` — convenience for the sign-in Server Action
- `logSignOut(userId)` — convenience for the sign-out route

All three use the service-role admin client because `audit_logs` is INSERT-only for the service role per the RLS matrix (§ 6.2). Each helper resolves the user's `operator_id` from `profiles` before inserting.

- [ ] **Step 1: Write the failing test.**

File `apps/portal/tests/lib/auth/audit.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const singleMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "profiles") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: singleMock,
        }),
      }),
    };
  }
  if (table === "audit_logs") {
    return { insert: insertMock };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("logAuditEvent", () => {
  it("inserts a row with the resolved operator_id and provided fields", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logAuditEvent } = await import("@/lib/auth/audit");

    await logAuditEvent({
      actorUserId: "user-1",
      action: "property.created",
      entityType: "property",
      entityId: "prop-9",
      details: { name: "Test Inn" },
    });

    expect(insertMock).toHaveBeenCalledWith({
      operator_id: "op-1",
      actor_user_id: "user-1",
      actor_type: "USER",
      action: "property.created",
      entity_type: "property",
      entity_id: "prop-9",
      details: { name: "Test Inn" },
    });
  });

  it("skips the insert if the actor profile cannot be resolved", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: null });
    const { logAuditEvent } = await import("@/lib/auth/audit");

    await logAuditEvent({
      actorUserId: "ghost",
      action: "user.signed_in",
      entityType: "user",
      entityId: "ghost",
    });

    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("logSignIn", () => {
  it("writes a user.signed_in row", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logSignIn } = await import("@/lib/auth/audit");

    await logSignIn("user-1");

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        actor_user_id: "user-1",
        actor_type: "USER",
        action: "user.signed_in",
        entity_type: "user",
        entity_id: "user-1",
      }),
    );
  });
});

describe("logSignOut", () => {
  it("writes a user.signed_out row", async () => {
    singleMock.mockResolvedValueOnce({
      data: { operator_id: "op-1" },
      error: null,
    });
    insertMock.mockResolvedValueOnce({ error: null });
    const { logSignOut } = await import("@/lib/auth/audit");

    await logSignOut("user-1");

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.signed_out",
        actor_user_id: "user-1",
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run:
```bash
pnpm --filter @lc/portal test -- tests/lib/auth/audit.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/auth/audit'".

- [ ] **Step 3: Write the implementation.**

File `apps/portal/lib/auth/audit.ts`:
```ts
// apps/portal/lib/auth/audit.ts
//
// Audit-log writers. Always use the service-role client — `audit_logs` is
// INSERT-only for service role per the RLS matrix (spec §6.2). The actor's
// operator_id is resolved from `profiles` so we never trust caller input
// for tenancy scoping.

import "server-only";
import type { Json } from "@lc/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuditEvent = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Json;
};

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const admin = createAdminClient();

  const { data: actor } = await admin
    .from("profiles")
    .select("operator_id")
    .eq("id", event.actorUserId)
    .maybeSingle();

  if (!actor) {
    // No profile means we cannot scope the row to an operator. Skip rather
    // than insert an orphaned audit row. The caller's main action already
    // succeeded; audit is best-effort.
    return;
  }

  await admin.from("audit_logs").insert({
    operator_id: actor.operator_id,
    actor_user_id: event.actorUserId,
    actor_type: "USER",
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    details: event.details ?? null,
  });
}

export async function logSignIn(userId: string): Promise<void> {
  await logAuditEvent({
    actorUserId: userId,
    action: "user.signed_in",
    entityType: "user",
    entityId: userId,
  });
}

export async function logSignOut(userId: string): Promise<void> {
  await logAuditEvent({
    actorUserId: userId,
    action: "user.signed_out",
    entityType: "user",
    entityId: userId,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run:
```bash
pnpm --filter @lc/portal test -- tests/lib/auth/audit.test.ts
```

Expected: PASS — all four `it` blocks green.

- [ ] **Step 5: Commit.**

```bash
git add apps/portal/lib/auth/audit.ts apps/portal/tests/lib/auth/audit.test.ts
git commit -m "feat(portal): audit log helpers for sign-in/sign-out events"
```

---

## Task 5: Middleware auth gate

**Files:**
- Create: `apps/portal/middleware.ts`

Refreshes the Supabase session cookie on every request that matches the matcher, then redirects to `/sign-in` if no session exists. The matcher excludes static assets, the `/sign-in` page itself, and `/api/*` (API routes do their own auth — Twilio webhooks use HMAC, Agora token route will check the kiosk config token, etc.).

- [ ] **Step 1: Create the middleware.**

File `apps/portal/middleware.ts`:
```ts
// apps/portal/middleware.ts
//
// Runs on every portal page request (matcher below). Two jobs:
//   1. Refresh the Supabase auth cookie so server-rendered pages see a
//      fresh session.
//   2. Redirect unauthenticated users to /sign-in.
//
// API routes are excluded from the matcher — they authenticate themselves
// (Twilio HMAC, kiosk config token, service-role-only invites, etc.). The
// /sign-in page itself is excluded so unauthenticated users can reach it.

import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signInUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Match every path EXCEPT:
    //   - _next/static (build assets)
    //   - _next/image (image optimization)
    //   - favicon.ico
    //   - api/* (API routes do their own auth)
    //   - sign-in (the sign-in page itself)
    //   - auth/* (sign-out POST + future password-reset/callback routes)
    "/((?!_next/static|_next/image|favicon.ico|api/|sign-in|auth/).*)",
  ],
};
```

- [ ] **Step 2: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/portal/middleware.ts
git commit -m "feat(portal): middleware auth gate redirecting unauthed to /sign-in"
```

---

## Task 6: `(auth)` route group — sign-in page + Server Action

**Files:**
- Create: `apps/portal/app/(auth)/layout.tsx`
- Create: `apps/portal/app/(auth)/sign-in/page.tsx`
- Create: `apps/portal/app/(auth)/sign-in/actions.ts`

The sign-in form is a Server-Action-driven form. `useActionState` gives us inline error display ("Invalid email or password") without leaking which side was wrong (don't reveal whether the email exists). On success, the action calls `logSignIn` and `redirect('/')` — the root page then routes to the role-appropriate dashboard (Task 8).

- [ ] **Step 1: Create the auth route group layout.**

File `apps/portal/app/(auth)/layout.tsx`:
```tsx
// Auth layout — no sidebar, no header, just a centered card on the page
// background. Used by /sign-in (and later /onboarding, /reset-password).

export default function AuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the sign-in Server Action.**

File `apps/portal/app/(auth)/sign-in/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { logSignIn } from "@/lib/auth/audit";

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
    return { error: "Invalid email or password." };
  }

  await logSignIn(data.user.id);
  redirect("/");
}
```

- [ ] **Step 3: Create the sign-in page.**

File `apps/portal/app/(auth)/sign-in/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Lobby Connect</h1>
        <p className="text-sm text-text-muted">Sign in to your account.</p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <a
        href="/forgot-password"
        className="text-center text-sm text-text-muted hover:text-foreground"
      >
        Forgot password?
      </a>
    </form>
  );
}
```

- [ ] **Step 4: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add "apps/portal/app/(auth)"
git commit -m "feat(portal): sign-in page + Server Action with audit log write"
```

---

## Task 7: Sign-out route handler

**Files:**
- Create: `apps/portal/app/auth/signout/route.ts`

A POST handler that signs the user out and redirects to `/sign-in`. POST-only because sign-out is a state-changing action — GET sign-out is a classic CSRF anti-pattern. We log the audit row BEFORE signing out so we still have the user id.

- [ ] **Step 1: Create the route.**

File `apps/portal/app/auth/signout/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { logSignOut } from "@/lib/auth/audit";

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await logSignOut(user.id);
  }

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/sign-in", request.url), { status: 303 });
}
```

- [ ] **Step 2: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/portal/app/auth/signout
git commit -m "feat(portal): POST /auth/signout — clears session, logs audit row"
```

---

## Task 8: Role-based root redirect

**Files:**
- Modify: `apps/portal/app/page.tsx`

The root page becomes a Server Component that reads the user's role and redirects to `/agent`, `/admin`, or `/owner`. If somehow the user has no profile (shouldn't happen — middleware already verified session, and seeding/invites always create a profile alongside the auth user), we fall back to `/sign-out` to clear the session cleanly.

- [ ] **Step 1: Replace the page.**

File `apps/portal/app/page.tsx` (full replacement):
```tsx
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }

  switch (profile.role) {
    case "AGENT":
      redirect("/agent");
    case "ADMIN":
      redirect("/admin");
    case "OWNER":
      redirect("/owner");
    default:
      redirect("/sign-in");
  }
}
```

- [ ] **Step 2: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/portal/app/page.tsx
git commit -m "feat(portal): root page routes to role-specific dashboard"
```

---

## Task 9: Role-grouped layouts + placeholder dashboards

**Files:**
- Create: `apps/portal/app/(agent)/layout.tsx`
- Create: `apps/portal/app/(agent)/agent/page.tsx`
- Create: `apps/portal/app/(admin)/layout.tsx`
- Create: `apps/portal/app/(admin)/admin/page.tsx`
- Create: `apps/portal/app/(owner)/layout.tsx`
- Create: `apps/portal/app/(owner)/owner/page.tsx`

Each route group's layout calls `requireRole(...)` so the layout body only renders for the correct role. Pages are intentionally minimal — they're slot-fillers for later plans to flesh out. They render the placeholder dashboard inside a centered card matching the home page style.

- [ ] **Step 1: Agent layout + page.**

File `apps/portal/app/(agent)/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("AGENT");
  return <>{children}</>;
}
```

File `apps/portal/app/(agent)/agent/page.tsx`:
```tsx
export default function AgentDashboardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-foreground">Agent dashboard</h1>
        <p className="mt-2 text-sm text-text-muted">
          Placeholder — voice path + property cards land in Plan 5.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}

function SignOutButton() {
  return (
    <form action="/auth/signout" method="post" className="mt-6">
      <button
        type="submit"
        className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Admin layout + page.**

File `apps/portal/app/(admin)/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("ADMIN");
  return <>{children}</>;
}
```

File `apps/portal/app/(admin)/admin/page.tsx`:
```tsx
export default function AdminDashboardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-foreground">Admin dashboard</h1>
        <p className="mt-2 text-sm text-text-muted">
          Placeholder — properties + agents + assignments land in Plan 4.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Owner layout + page.**

File `apps/portal/app/(owner)/layout.tsx`:
```tsx
import { requireRole } from "@/lib/auth/require-role";

export default async function OwnerLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("OWNER");
  return <>{children}</>;
}
```

File `apps/portal/app/(owner)/owner/page.tsx`:
```tsx
export default function OwnerDashboardPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-foreground">Owner portal</h1>
        <p className="mt-2 text-sm text-text-muted">
          Placeholder — properties + recordings land in Plan 6.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + run all tests.**

Run:
```bash
pnpm typecheck
pnpm test
```

Expected: both PASS.

- [ ] **Step 5: Commit.**

```bash
git add "apps/portal/app/(agent)" "apps/portal/app/(admin)" "apps/portal/app/(owner)"
git commit -m "feat(portal): role-grouped layouts + placeholder dashboards"
```

---

## Task 10: `/auth/callback` route (PKCE code exchange)

**Files:**
- Create: `apps/portal/app/auth/callback/route.ts`

This route is the landing point for all Supabase email links — password reset (this plan) and invite acceptance (Plan 4). Supabase appends a `code` query param; the handler exchanges it for a session via `exchangeCodeForSession`, then redirects to the `next` param. The caller (forgot-password action, invite API route) bakes `next` into the `redirectTo` URL they pass to Supabase.

The route lives at URL `/auth/callback` — already excluded from the middleware matcher.

- [ ] **Step 1: Create the route.**

File `apps/portal/app/auth/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/sign-in", origin));
}
```

- [ ] **Step 2: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/portal/app/auth/callback
git commit -m "feat(portal): /auth/callback — PKCE code exchange for email links"
```

---

## Task 11: Forgot-password page + action

**Files:**
- Create: `apps/portal/app/(auth)/forgot-password/actions.ts`
- Create: `apps/portal/app/(auth)/forgot-password/page.tsx`

Calls `resetPasswordForEmail` with a `redirectTo` pointing at `/auth/callback?next=/auth/update-password`. Always returns a success state regardless of whether the email exists — never reveal which emails are registered (invite-only system, but still good practice).

- [ ] **Step 1: Create the Server Action.**

File `apps/portal/app/(auth)/forgot-password/actions.ts`:
```ts
"use server";

import { createServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export type ForgotPasswordState = {
  error: string | null;
  success: boolean;
};

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter your email address.", success: false };
  }

  const supabase = await createServerClient();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectTo = `${appUrl}/auth/callback?next=/auth/update-password`;

  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  // Always succeed — never confirm whether the email is registered.
  return { error: null, success: true };
}
```

- [ ] **Step 2: Create the page.**

File `apps/portal/app/(auth)/forgot-password/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, success: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initialState,
  );

  if (state.success) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          Check your inbox
        </h1>
        <p className="text-sm text-text-muted">
          If that email is registered, you&apos;ll receive a reset link
          shortly.
        </p>
        <a href="/sign-in" className="text-sm text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">
          Reset password
        </h1>
        <p className="text-sm text-text-muted">
          Enter your email and we&apos;ll send a reset link.
        </p>
      </header>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <a
        href="/sign-in"
        className="text-center text-sm text-text-muted hover:text-foreground"
      >
        Back to sign in
      </a>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add "apps/portal/app/(auth)/forgot-password"
git commit -m "feat(portal): forgot-password page + resetPasswordForEmail action"
```

---

## Task 12: Update-password page + action

**Files:**
- Create: `apps/portal/app/auth/update-password/actions.ts`
- Create: `apps/portal/app/auth/update-password/page.tsx`

The user lands here after clicking the reset email link (via `/auth/callback`). At that point Supabase has set a recovery session. The action calls `updateUser({ password })`, emits a `user.password_reset` audit row, then redirects to `/` (which routes to their dashboard — they remain signed in after the reset).

This lives at URL `/auth/update-password` (real `app/auth/` directory, not route group), which is already excluded from the middleware matcher. The page uses an inline card rather than the `(auth)` layout to keep the route at the right URL.

- [ ] **Step 1: Create the Server Action.**

File `apps/portal/app/auth/update-password/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

export type UpdatePasswordState = {
  error: string | null;
};

export async function updatePasswordAction(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Failed to update password. Please try again." };
  }

  await logAuditEvent({
    actorUserId: user.id,
    action: "user.password_reset",
    entityType: "user",
    entityId: user.id,
  });

  redirect("/");
}
```

- [ ] **Step 2: Create the page.**

File `apps/portal/app/auth/update-password/page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "./actions";

const initialState: UpdatePasswordState = { error: null };

export default function UpdatePasswordPage() {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    initialState,
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
        <form action={formAction} className="flex flex-col gap-5">
          <header className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-foreground">
              Set new password
            </h1>
            <p className="text-sm text-text-muted">
              Enter a new password for your account.
            </p>
          </header>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">New password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">
              Confirm password
            </span>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="rounded-md border border-input bg-background px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck.**

Run:
```bash
pnpm --filter @lc/portal typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/portal/app/auth/update-password
git commit -m "feat(portal): update-password page + action with audit log write"
```

---

## Task 13: Final verification + tag

**Files:** none (verification + tagging only).

- [ ] **Step 1: Run full repo lint + typecheck + test from the root.**

Run:
```bash
cd "/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect"
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three PASS. If any fail, fix before continuing.

- [ ] **Step 2: Build the portal to catch Next.js-only errors.**

Run:
```bash
pnpm --filter @lc/portal build
```

Expected: PASS — Next.js compiles all routes including `(auth)`, `(agent)`, `(admin)`, `(owner)`.

If `build` fails because env vars are missing, that's expected for a CI-style build environment. Either set the vars in `apps/portal/.env.local` (real Supabase project values) or note this in the commit message — the dev/test loop does not require build to pass.

- [ ] **Step 3: Manual smoke.**

Prerequisites: Docker Desktop running, `pnpm supabase:start` + `pnpm exec supabase db reset` complete, `apps/portal/.env.local` populated with local keys (see pre-flight).

Run `pnpm dev:portal`. Wait for "Ready in ...ms". Then:

**Sign-in / sign-out:**
1. Visit `http://localhost:3000/`. Expected: 302 → `/sign-in`.
2. Sign in as `admin@lobbyconnect.local` / `localdev123`. Expected: 302 chain → `/` → `/admin`. Page shows "Admin dashboard".
3. Click **Sign out**. Expected: 302 → `/sign-in`.
4. In Supabase Studio (`http://localhost:54323`) → Table Editor → `audit_logs`: verify two rows with `action='user.signed_in'` and `action='user.signed_out'`.

**Role guard:**
5. Sign in again as admin. Visit `http://localhost:3000/agent`. Expected: 302 → `/` → `/admin` (wrong-role redirect).
6. Sign out. Visit `http://localhost:3000/admin` directly. Expected: middleware 302 → `/sign-in`.

**Password reset:**
7. On the sign-in page, click **Forgot password?**. Expected: `/forgot-password` page.
8. Enter `admin@lobbyconnect.local` and click **Send reset link**. Expected: success state ("Check your inbox").
9. In Supabase Studio → Authentication → Users → find the admin user → check the "Recovery sent at" timestamp updated.
10. *(Optional — requires email delivery)* Click the reset link from the email. Expected: `/auth/callback?code=...` → `/auth/update-password`. Enter a new password. Expected: 302 → `/admin`. In `audit_logs`: new row with `action='user.password_reset'`.

- [ ] **Step 4: Tag the plan complete.**

```bash
git tag plan-03-auth-routing-complete
git push origin main --tags
```

- [ ] **Step 5: Update the project-status memory.**

Update `/Users/kumarthakkar/.claude/projects/-Users-kumarthakkar-Documents-Claude-Projects-Lobby-Connect/memory/project-status.md` so the **Plan 2** section becomes **Plan 3**, recording:
- Tag pushed: `plan-03-auth-routing-complete`
- What was built (Supabase clients, middleware gate, sign-in/sign-out/forgot-password/update-password, role layouts, audit on auth events, `/auth/callback` code-exchange route)
- Manual smoke status (completed vs deferred)
- Next plan: **Plan 4 — Admin CRUD** (includes the deferred `/onboarding` page).

---

## Self-review checklist

Before declaring the plan ready, the writer ran these checks:

**Spec coverage.** Each requirement from spec §6.1 (auth flow) and §6.2 (RLS matrix interactions on auth events) maps to a task:

| Spec § 6.1 step | Covered by |
|---|---|
| 1. Invitation | **Deferred to Plan 4** (called out in goal block) |
| 2. First sign-in / onboarding | **Deferred to Plan 4** (called out in goal block) |
| 3. Subsequent sign-in | Task 6 (sign-in page + action) |
| 4. Middleware gate | Task 5 |
| 5. Role guards via route groups | Tasks 3 + 9 |
| 6. Sign-out | Task 7 |
| Password reset (spec § 6.1 implied — email/pwd auth) | Tasks 10 + 11 + 12 |

Audit log for sign-in / sign-out / password-reset: Task 4 (`logAuditEvent`) + individual action files.

**Placeholder scan.** Searched the plan for "TBD", "fill in", "appropriate error handling", "etc.", "..." inside code blocks — none found in steps that produce code.

**Type consistency.** `RequiredProfile` from `require-role.ts` has the fields used in the tests. `AuditEvent.entityId` is optional in the type; the implementation defaults it to `null` for the insert, matching the audit_logs schema. The Supabase client factories all consume `Database` from `@lc/shared`, which already exports it via `index.ts`.

**One known soft spot.** The sign-in Server Action returns the same error message for both "wrong password" and "user doesn't exist" — that's deliberate (avoids user-enumeration) and matches the spec's invite-only model.
