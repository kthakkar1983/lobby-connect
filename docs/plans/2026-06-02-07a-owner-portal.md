# Owner Portal — Read Views (7a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a hotel owner a mobile-first portal to see after-hours coverage at a glance, full call history (audio + video), and emergency incidents — all read-only.

**Architecture:** Pure presentational/derivation helpers (`lib/owner/`, TDD) feed Server Components that fetch through the **user-scoped** Supabase client (RLS does owner-scoping — no new migration, no new API route, no service-role). Two small `"use client"` islands provide nav highlighting and a `router.refresh()`-based 20s poller. Every owner *write* (kiosk edit, playbook upload, incident resolve) is deferred to 7b.

**Tech Stack:** Next.js 15.5 App Router (RSC, async `params`/`searchParams`, `typedRoutes`), Supabase SSR client, Tailwind + shadcn (`badge`, `skeleton`, existing `UserMenu`), lucide-react, Vitest.

**Spec:** `docs/specs/2026-06-02-07a-owner-portal-design.md`

---

## Conventions for every task

- **Test commands** (run from `apps/portal/`): `pnpm test` (all), `pnpm test -- <file>` (one file), `pnpm typecheck`, `pnpm lint`.
- **Imports:** shared types from `@lc/shared`; app code via `@/…`. Class merge via `cn` from `@/lib/utils`.
- **Tokens only** — no raw hex. Status dots use Tailwind palette utilities (`bg-emerald-500` etc.), which are allowed (palette tokens, not hex literals).
- **Typed-routes forward refs:** internal `<Link>` hrefs to owner routes use `href={... as never}` (the CLAUDE.md convention) so each task's `typecheck` stays green even before sibling routes exist.
- **Next 15 async APIs:** `params` and `searchParams` are Promises — always `await` them.
- Owners are call-takers? No. The owner layout must NOT mount `Softphone`/`VideoCallHost`.

## File structure (locked)

```
apps/portal/
  lib/owner/
    format.ts        ← state/status/presence labels + badge variants, duration, tz call-time   (Task 1)
    summary.ts       ← tz-aware today-call counting + open-incident counting                    (Task 2)
    nav.ts           ← activeOwnerTab(pathname)                                                  (Task 3)
  tests/owner/
    format.test.ts   (Task 1)   summary.test.ts (Task 2)   nav.test.ts (Task 3)
  components/owner/
    auto-refresh.tsx ← <AutoRefresh intervalMs> client island (router.refresh on interval+focus) (Task 4)
    owner-nav.tsx    ← <OwnerTopNav> (md+ header) + <OwnerBottomNav> (mobile fixed), shared TABS  (Task 5)
  app/(owner)/
    layout.tsx                          ← shell: header (logo + OwnerTopNav + UserMenu) + OwnerBottomNav  (Task 6)
    owner/
      page.tsx                          ← Home overview (RSC) + <AutoRefresh>                     (Task 7)
      loading.tsx                       ← Home skeleton                                           (Task 7)
      properties/[id]/page.tsx          ← property detail (read)                                  (Task 8)
      calls/page.tsx                    ← call history (RSC, ?property/?limit) + <AutoRefresh>     (Task 9)
      calls/loading.tsx                 ← calls skeleton                                          (Task 9)
      calls/[id]/page.tsx               ← call detail (+ recording seam + incident link)          (Task 10)
      incidents/page.tsx                ← incident list (RSC) + <AutoRefresh>                      (Task 11)
      incidents/loading.tsx             ← incidents skeleton                                      (Task 11)
      incidents/[id]/page.tsx           ← incident detail (read)                                  (Task 12)
```

---

### Task 1: `lib/owner/format.ts` — display mappers + formatters

**Files:**
- Create: `apps/portal/lib/owner/format.ts`
- Test: `apps/portal/tests/owner/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  callStateLabel,
  callStateBadgeVariant,
  incidentStatusLabel,
  incidentStatusBadgeVariant,
  presenceLabel,
  presenceDotClass,
  formatDuration,
  formatCallTime,
} from "@/lib/owner/format";

describe("callStateLabel", () => {
  it("maps every CallState to an owner-friendly label", () => {
    expect(callStateLabel("RINGING")).toBe("Ringing");
    expect(callStateLabel("IN_PROGRESS")).toBe("In progress");
    expect(callStateLabel("COMPLETED")).toBe("Completed");
    expect(callStateLabel("NO_ANSWER")).toBe("Missed");
    expect(callStateLabel("FAILED")).toBe("Failed");
  });
});

describe("callStateBadgeVariant", () => {
  it("uses destructive for missed/failed, default for answered", () => {
    expect(callStateBadgeVariant("COMPLETED")).toBe("default");
    expect(callStateBadgeVariant("IN_PROGRESS")).toBe("default");
    expect(callStateBadgeVariant("RINGING")).toBe("secondary");
    expect(callStateBadgeVariant("NO_ANSWER")).toBe("destructive");
    expect(callStateBadgeVariant("FAILED")).toBe("destructive");
  });
});

describe("incident mappers", () => {
  it("labels and colors OPEN vs RESOLVED", () => {
    expect(incidentStatusLabel("OPEN")).toBe("Open");
    expect(incidentStatusLabel("RESOLVED")).toBe("Resolved");
    expect(incidentStatusBadgeVariant("OPEN")).toBe("destructive");
    expect(incidentStatusBadgeVariant("RESOLVED")).toBe("secondary");
  });
});

describe("presence", () => {
  it("labels and dot-colors each ProfileStatus", () => {
    expect(presenceLabel("AVAILABLE")).toBe("Available");
    expect(presenceLabel("ON_CALL")).toBe("On call");
    expect(presenceLabel("AWAY")).toBe("Away");
    expect(presenceLabel("OFFLINE")).toBe("Offline");
    expect(presenceDotClass("AVAILABLE")).toBe("bg-emerald-500");
    expect(presenceDotClass("OFFLINE")).toBe("bg-zinc-300");
  });
});

describe("formatDuration", () => {
  it("renders m/s and a dash for empty", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(65)).toBe("1m 5s");
    expect(formatDuration(120)).toBe("2m 0s");
  });
});

describe("formatCallTime", () => {
  it("renders the instant in the property's timezone", () => {
    const iso = "2026-06-02T03:00:00Z";
    const ny = formatCallTime(iso, "America/New_York");
    const la = formatCallTime(iso, "America/Los_Angeles");
    expect(ny).not.toBe(la); // 11:00 PM vs 8:00 PM the prior day
    expect(ny).toContain("11:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/owner/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/owner/format`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/owner/format.ts`:

```ts
import type { CallState, IncidentStatus, ProfileStatus } from "@lc/shared";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const CALL_STATE_LABELS: Record<CallState, string> = {
  RINGING: "Ringing",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  NO_ANSWER: "Missed",
  FAILED: "Failed",
};

export function callStateLabel(state: CallState): string {
  return CALL_STATE_LABELS[state];
}

const CALL_STATE_VARIANTS: Record<CallState, BadgeVariant> = {
  RINGING: "secondary",
  IN_PROGRESS: "default",
  COMPLETED: "default",
  NO_ANSWER: "destructive",
  FAILED: "destructive",
};

export function callStateBadgeVariant(state: CallState): BadgeVariant {
  return CALL_STATE_VARIANTS[state];
}

export function incidentStatusLabel(status: IncidentStatus): string {
  return status === "RESOLVED" ? "Resolved" : "Open";
}

export function incidentStatusBadgeVariant(status: IncidentStatus): BadgeVariant {
  return status === "RESOLVED" ? "secondary" : "destructive";
}

const PRESENCE_LABELS: Record<ProfileStatus, string> = {
  AVAILABLE: "Available",
  ON_CALL: "On call",
  AWAY: "Away",
  OFFLINE: "Offline",
};

export function presenceLabel(status: ProfileStatus): string {
  return PRESENCE_LABELS[status];
}

const PRESENCE_DOTS: Record<ProfileStatus, string> = {
  AVAILABLE: "bg-emerald-500",
  ON_CALL: "bg-blue-500",
  AWAY: "bg-amber-500",
  OFFLINE: "bg-zinc-300",
};

export function presenceDotClass(status: ProfileStatus): string {
  return PRESENCE_DOTS[status];
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/owner/format.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/format.ts apps/portal/tests/owner/format.test.ts
git commit -m "feat(7a): owner display mappers + tz call-time formatter"
```

---

### Task 2: `lib/owner/summary.ts` — tz-aware counting

**Files:**
- Create: `apps/portal/lib/owner/summary.ts`
- Test: `apps/portal/tests/owner/summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isToday,
  countTodayCalls,
  isOpenIncident,
  countOpenIncidents,
} from "@/lib/owner/summary";

const NOW = new Date("2026-06-02T16:00:00Z"); // 12:00 PM in New York (UTC-4)

describe("isToday (timezone-aware)", () => {
  it("is true for an instant on the same local calendar day", () => {
    // 2026-06-02 09:00 local NY
    expect(isToday("2026-06-02T13:00:00Z", "America/New_York", NOW)).toBe(true);
  });

  it("is false for yesterday in that timezone", () => {
    // 2026-06-01 23:00 local NY
    expect(isToday("2026-06-02T03:00:00Z", "America/New_York", NOW)).toBe(false);
  });

  it("respects the property timezone, not the server's", () => {
    // 2026-06-02 03:00Z is still 2026-06-01 20:00 in LA → not "today" in LA
    expect(isToday("2026-06-02T03:00:00Z", "America/Los_Angeles", NOW)).toBe(false);
  });
});

describe("countTodayCalls", () => {
  it("counts only calls whose local day equals today", () => {
    const calls = [
      { ring_started_at: "2026-06-02T13:00:00Z" }, // today NY
      { ring_started_at: "2026-06-02T14:30:00Z" }, // today NY
      { ring_started_at: "2026-06-02T03:00:00Z" }, // yesterday NY
    ];
    expect(countTodayCalls(calls, "America/New_York", NOW)).toBe(2);
  });
});

describe("incident counting", () => {
  it("treats anything not RESOLVED as open", () => {
    expect(isOpenIncident("OPEN")).toBe(true);
    expect(isOpenIncident("RESOLVED")).toBe(false);
    expect(
      countOpenIncidents([{ status: "OPEN" }, { status: "RESOLVED" }, { status: "OPEN" }]),
    ).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/owner/summary.test.ts`
Expected: FAIL — cannot resolve `@/lib/owner/summary`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/owner/summary.ts`:

```ts
import type { IncidentStatus } from "@lc/shared";

// "YYYY-MM-DD" for the given instant in the given timezone (en-CA → ISO order).
function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function isToday(iso: string, timeZone: string, now: Date): boolean {
  return localDateKey(iso, timeZone) === localDateKey(now.toISOString(), timeZone);
}

export function countTodayCalls(
  calls: ReadonlyArray<{ ring_started_at: string }>,
  timeZone: string,
  now: Date,
): number {
  return calls.filter((c) => isToday(c.ring_started_at, timeZone, now)).length;
}

export function isOpenIncident(status: IncidentStatus): boolean {
  return status !== "RESOLVED";
}

export function countOpenIncidents(
  incidents: ReadonlyArray<{ status: IncidentStatus }>,
): number {
  return incidents.filter((i) => isOpenIncident(i.status)).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/owner/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/summary.ts apps/portal/tests/owner/summary.test.ts
git commit -m "feat(7a): tz-aware today-call + open-incident counting"
```

---

### Task 3: `lib/owner/nav.ts` — active tab resolution

**Files:**
- Create: `apps/portal/lib/owner/nav.ts`
- Test: `apps/portal/tests/owner/nav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/owner/nav.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeOwnerTab } from "@/lib/owner/nav";

describe("activeOwnerTab", () => {
  it("treats /owner and property drill-downs as Home", () => {
    expect(activeOwnerTab("/owner")).toBe("home");
    expect(activeOwnerTab("/owner/properties/abc")).toBe("home");
  });
  it("matches Calls on /owner/calls and its details", () => {
    expect(activeOwnerTab("/owner/calls")).toBe("calls");
    expect(activeOwnerTab("/owner/calls/123")).toBe("calls");
  });
  it("matches Incidents on /owner/incidents and its details", () => {
    expect(activeOwnerTab("/owner/incidents")).toBe("incidents");
    expect(activeOwnerTab("/owner/incidents/9")).toBe("incidents");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/owner/nav.test.ts`
Expected: FAIL — cannot resolve `@/lib/owner/nav`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/owner/nav.ts`:

```ts
export type OwnerTab = "home" | "calls" | "incidents";

export function activeOwnerTab(pathname: string): OwnerTab {
  if (pathname.startsWith("/owner/calls")) return "calls";
  if (pathname.startsWith("/owner/incidents")) return "incidents";
  return "home";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/owner/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/nav.ts apps/portal/tests/owner/nav.test.ts
git commit -m "feat(7a): owner active-tab resolver"
```

---

### Task 4: `<AutoRefresh>` poller island

**Files:**
- Create: `apps/portal/components/owner/auto-refresh.tsx`

No unit test (thin React effect; verified at smoke). Keep the interval named for clarity.

- [ ] **Step 1: Write the component**

Create `apps/portal/components/owner/auto-refresh.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-runs the enclosing Server Component's data fetch on an interval and on
 * window focus by calling router.refresh(). This is locked decision 4 (20s
 * polling + refetch-on-focus) without any client-side polling route.
 */
export function AutoRefresh({ intervalMs = 20_000 }: { readonly intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const id = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, [router, intervalMs]);
  return null;
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/owner/auto-refresh.tsx
git commit -m "feat(7a): AutoRefresh poller island (router.refresh on interval+focus)"
```

---

### Task 5: Owner nav (top + bottom)

**Files:**
- Create: `apps/portal/components/owner/owner-nav.tsx`

One client component exporting both nav variants from a shared `TABS` array + `activeOwnerTab`. `OwnerTopNav` shows on `md+` (in the header); `OwnerBottomNav` is the mobile fixed thumb-bar (`md:hidden`).

- [ ] **Step 1: Write the component**

Create `apps/portal/components/owner/owner-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Phone, Siren, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeOwnerTab, type OwnerTab } from "@/lib/owner/nav";

type Tab = { readonly tab: OwnerTab; readonly href: string; readonly label: string; readonly icon: LucideIcon };

const TABS: readonly Tab[] = [
  { tab: "home", href: "/owner", label: "Home", icon: Home },
  { tab: "calls", href: "/owner/calls", label: "Calls", icon: Phone },
  { tab: "incidents", href: "/owner/incidents", label: "Incidents", icon: Siren },
];

export function OwnerTopNav() {
  const active = activeOwnerTab(usePathname());
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
      {TABS.map(({ tab, href, label }) => (
        <Link
          key={tab}
          href={href as never}
          aria-current={active === tab ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === tab ? "bg-primary/10 text-primary" : "text-text-muted hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function OwnerBottomNav() {
  const active = activeOwnerTab(usePathname());
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card md:hidden"
      aria-label="Primary"
    >
      {TABS.map(({ tab, href, label, icon: Icon }) => (
        <Link
          key={tab}
          href={href as never}
          aria-current={active === tab ? "page" : undefined}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium",
            active === tab ? "text-primary" : "text-text-muted",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/owner/owner-nav.tsx
git commit -m "feat(7a): owner top+bottom nav (shared tabs, active highlight)"
```

---

### Task 6: Owner shell layout

**Files:**
- Modify (replace): `apps/portal/app/(owner)/layout.tsx`

Replaces the bare `requireRole` layout with the real shell. Mirrors the admin identity query for the `UserMenu`. No softphone/video.

- [ ] **Step 1: Replace the layout**

Replace the entire contents of `apps/portal/app/(owner)/layout.tsx`:

```tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { UserMenu } from "@/components/user-menu";
import { OwnerTopNav, OwnerBottomNav } from "@/components/owner/owner-nav";

export default async function OwnerLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const profile = await requireRole("OWNER");

  // One small query for the header identity (name + email), mirroring the admin layout.
  const supabase = await createServerClient();
  const { data: identity } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", profile.id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-6">
          <Link href="/owner" className="text-base font-semibold text-foreground">
            Lobby Connect
          </Link>
          <OwnerTopNav />
        </div>
        <UserMenu
          fullName={identity?.full_name ?? ""}
          email={identity?.email ?? ""}
          role="OWNER"
        />
      </header>
      <main className="flex-1 px-4 py-6 pb-24 md:pb-6">{children}</main>
      <OwnerBottomNav />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean. (The placeholder `owner/page.tsx` still renders inside `<main>` until Task 7.)

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(owner)/layout.tsx"
git commit -m "feat(7a): owner shell — header + nav + UserMenu"
```

---

### Task 7: Home overview

**Files:**
- Modify (replace): `apps/portal/app/(owner)/owner/page.tsx`
- Create: `apps/portal/app/(owner)/owner/loading.tsx`

Per-property glance card: assigned agent + presence dot, today's call count, open-incident badge. Multi-query fetch + pure derivation helpers.

- [ ] **Step 1: Replace the Home page**

Replace the entire contents of `apps/portal/app/(owner)/owner/page.tsx`:

```tsx
import Link from "next/link";
import { Building2, ChevronRight, Siren } from "lucide-react";
import type { ProfileStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { presenceLabel, presenceDotClass } from "@/lib/owner/format";
import { countTodayCalls, countOpenIncidents } from "@/lib/owner/summary";
import { AutoRefresh } from "@/components/owner/auto-refresh";

export default async function OwnerHomePage() {
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();
  const now = new Date();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id)
    .eq("active", true)
    .order("name");

  const props = properties ?? [];
  const propIds = props.map((p) => p.id);

  // Active assignments → agent presence.
  const agentByProperty = new Map<string, { full_name: string; status: ProfileStatus }>();
  if (propIds.length > 0) {
    const { data: assignments } = await supabase
      .from("property_assignments")
      .select("property_id, primary_agent_id")
      .in("property_id", propIds)
      .is("effective_until", null);

    const agentIds = [...new Set((assignments ?? []).map((a) => a.primary_agent_id))];
    const agentMap = new Map<string, { full_name: string; status: ProfileStatus }>();
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("profiles")
        .select("id, full_name, status")
        .in("id", agentIds);
      for (const a of agents ?? []) agentMap.set(a.id, { full_name: a.full_name, status: a.status });
    }
    for (const a of assignments ?? []) {
      const agent = agentMap.get(a.primary_agent_id);
      if (agent) agentByProperty.set(a.property_id, agent);
    }
  }

  // Recent calls (last 48h covers any tz) + open incidents, counted per property.
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentCalls } = propIds.length
    ? await supabase
        .from("calls")
        .select("property_id, ring_started_at")
        .in("property_id", propIds)
        .gte("ring_started_at", since)
    : { data: [] };
  const { data: openIncidents } = propIds.length
    ? await supabase
        .from("incidents")
        .select("property_id, status")
        .in("property_id", propIds)
        .neq("status", "RESOLVED")
    : { data: [] };

  const cards = props.map((p) => {
    const agent = agentByProperty.get(p.id) ?? null;
    const todayCount = countTodayCalls(
      (recentCalls ?? []).filter((c) => c.property_id === p.id),
      p.timezone,
      now,
    );
    const openCount = countOpenIncidents(
      (openIncidents ?? []).filter((i) => i.property_id === p.id),
    );
    return { id: p.id, name: p.name, agent, todayCount, openCount };
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Home</h1>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Building2 className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No properties assigned to you yet.</p>
        </div>
      ) : (
        cards.map((c) => (
          <Link
            key={c.id}
            href={`/owner/properties/${c.id}` as never}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-col gap-2">
              <span className="text-lg font-medium text-foreground">{c.name}</span>
              {c.agent ? (
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <span className={cn("h-2 w-2 rounded-full", presenceDotClass(c.agent.status))} aria-hidden="true" />
                  {c.agent.full_name} · {presenceLabel(c.agent.status)}
                </span>
              ) : (
                <span className="text-sm text-text-muted">No agent assigned</span>
              )}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-text-muted">{c.todayCount} call{c.todayCount === 1 ? "" : "s"} today</span>
                {c.openCount > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <Siren className="h-3 w-3" aria-hidden="true" />
                    {c.openCount} open
                  </Badge>
                )}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-text-muted" aria-hidden="true" />
          </Link>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the loading skeleton**

Create `apps/portal/app/(owner)/owner/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerHomeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-32" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/page.tsx" "apps/portal/app/(owner)/owner/loading.tsx"
git commit -m "feat(7a): owner Home overview — per-property glance cards"
```

---

### Task 8: Property detail (read-only)

**Files:**
- Create: `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`

Read-only property view: basics (no routing DID), guest-facing kiosk content, playbook version, recent-calls preview. `notFound()` when the property isn't the owner's (RLS yields null).

- [ ] **Step 1: Write the page**

Create `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { callStateLabel, callStateBadgeVariant, formatCallTime } from "@/lib/owner/format";

function Field({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value && value.length > 0 ? value : "—"}</span>
    </div>
  );
}

export default async function OwnerPropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, name, timezone, property_phone_number, after_hours_support_phone, playbook_version, kiosk_welcome_heading, kiosk_welcome_message, kiosk_checkin_time, kiosk_checkout_time, kiosk_wifi_network, kiosk_wifi_password, kiosk_breakfast_hours, kiosk_apology_message",
    )
    .eq("id", id)
    .maybeSingle();

  if (!property) notFound();

  const { data: recent } = await supabase
    .from("calls")
    .select("id, channel, state, ring_started_at")
    .eq("property_id", id)
    .order("ring_started_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href="/owner" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Home
      </Link>
      <h1 className="text-2xl font-semibold text-foreground">{property.name}</h1>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Guest phone" value={property.property_phone_number} />
        <Field label="After-hours support" value={property.after_hours_support_phone} />
        <Field label="Timezone" value={property.timezone} />
        <Field label="Playbook" value={property.playbook_version ? `v${property.playbook_version}` : "No playbook yet"} />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-medium text-foreground">Guest-facing kiosk content</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Welcome heading" value={property.kiosk_welcome_heading} />
          <Field label="Welcome message" value={property.kiosk_welcome_message} />
          <Field label="Check-in" value={property.kiosk_checkin_time} />
          <Field label="Check-out" value={property.kiosk_checkout_time} />
          <Field label="Wi-Fi network" value={property.kiosk_wifi_network} />
          <Field label="Wi-Fi password" value={property.kiosk_wifi_password} />
          <Field label="Breakfast hours" value={property.kiosk_breakfast_hours} />
          <Field label="Apology message" value={property.kiosk_apology_message} />
        </div>
        <p className="text-xs text-text-muted">Editing these is coming in the owner self-service update (7b).</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Recent calls</h2>
          <Link href={"/owner/calls" as never} className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {(recent ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No calls yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(recent ?? []).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/owner/calls/${c.id}` as never}
                  className="flex items-center justify-between py-2.5 text-sm hover:text-primary"
                >
                  <span className="text-foreground">{formatCallTime(c.ring_started_at, property.timezone)}</span>
                  <span className="flex items-center gap-2 text-text-muted">
                    {c.channel === "VIDEO" ? "Video" : "Audio"}
                    <Badge variant={callStateBadgeVariant(c.state)}>{callStateLabel(c.state)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/page.tsx"
git commit -m "feat(7a): owner property detail (read-only)"
```

---

### Task 9: Call history list

**Files:**
- Create: `apps/portal/app/(owner)/owner/calls/page.tsx`
- Create: `apps/portal/app/(owner)/owner/calls/loading.tsx`

Reverse-chron call cards. `?property=<id>` filter (links, shown only when owner has >1 property) and `?limit=<n>` "Load more". AutoRefresh on the list.

- [ ] **Step 1: Write the page**

Create `apps/portal/app/(owner)/owner/calls/page.tsx`:

```tsx
import Link from "next/link";
import { Phone, Video } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { callStateLabel, callStateBadgeVariant, formatCallTime, formatDuration } from "@/lib/owner/format";
import { AutoRefresh } from "@/components/owner/auto-refresh";

const DEFAULT_LIMIT = 50;

export default async function OwnerCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; limit?: string }>;
}) {
  const { property, limit: limitParam } = await searchParams;
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id)
    .order("name");

  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const multiProperty = props.length > 1;
  const activeProperty = property && tzById.has(property) ? property : null;
  const limit = Math.min(Math.max(Number(limitParam) || DEFAULT_LIMIT, DEFAULT_LIMIT), 500);

  // Apply the filter on the PostgrestFilterBuilder BEFORE .order/.limit — those
  // return a transform builder that no longer exposes .eq/.in.
  let query = supabase
    .from("calls")
    .select("id, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number");
  query = activeProperty
    ? query.eq("property_id", activeProperty)
    : query.in("property_id", props.map((p) => p.id));
  const { data: calls } = await query
    .order("ring_started_at", { ascending: false })
    .limit(limit);
  const rows = calls ?? [];

  // Handler names (2-query pattern).
  const handlerIds = [...new Set(rows.map((c) => c.handled_by_user_id).filter((x): x is string => !!x))];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  const moreHref = (() => {
    const sp = new URLSearchParams();
    if (activeProperty) sp.set("property", activeProperty);
    sp.set("limit", String(limit + DEFAULT_LIMIT));
    return `/owner/calls?${sp.toString()}`;
  })();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Calls</h1>

      {multiProperty && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/owner/calls"
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              !activeProperty ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted",
            )}
          >
            All
          </Link>
          {props.map((p) => (
            <Link
              key={p.id}
              href={`/owner/calls?property=${p.id}` as never}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                activeProperty === p.id ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Phone className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No calls yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/owner/calls/${c.id}` as never}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {c.channel === "VIDEO" ? <Video className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
                    {formatCallTime(c.ring_started_at, tzById.get(c.property_id) ?? "UTC")}
                  </span>
                  <span className="text-xs text-text-muted">
                    {multiProperty ? `${nameById.get(c.property_id) ?? "—"} · ` : ""}
                    {c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered"}
                    {c.room_number ? ` · Room ${c.room_number}` : ""}
                    {` · ${formatDuration(c.duration_seconds)}`}
                  </span>
                </div>
                <Badge variant={callStateBadgeVariant(c.state)}>{callStateLabel(c.state)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length === limit && (
        <Link href={moreHref as never} className="self-center text-sm text-primary hover:underline">
          Load more
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the loading skeleton**

Create `apps/portal/app/(owner)/owner/calls/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerCallsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-24" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/calls/page.tsx" "apps/portal/app/(owner)/owner/calls/loading.tsx"
git commit -m "feat(7a): owner call history list (filter + load more)"
```

---

### Task 10: Call detail (+ recording seam)

**Files:**
- Create: `apps/portal/app/(owner)/owner/calls/[id]/page.tsx`

All call fields + notes; an "Emergency — view incident" link when an incident references the call; and the recording seam (renders **only** when `recording_url` is non-null — dark today, auto-on when recording ships).

- [ ] **Step 1: Write the page**

Create `apps/portal/app/(owner)/owner/calls/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { callStateLabel, callStateBadgeVariant, formatCallTime, formatDuration } from "@/lib/owner/format";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default async function OwnerCallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: call } = await supabase
    .from("calls")
    .select(
      "id, property_id, channel, state, caller_number, room_number, ring_started_at, answered_at, ended_at, duration_seconds, handled_by_user_id, notes, recording_url",
    )
    .eq("id", id)
    .maybeSingle();

  if (!call) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", call.property_id)
    .maybeSingle();
  const tz = property?.timezone ?? "UTC";

  let handler = "Unanswered";
  if (call.handled_by_user_id) {
    const { data: h } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", call.handled_by_user_id)
      .maybeSingle();
    handler = h?.full_name ?? "—";
  }

  const { data: incident } = await supabase
    .from("incidents")
    .select("id")
    .eq("call_id", id)
    .maybeSingle();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href="/owner/calls" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Calls
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">
          {call.channel === "VIDEO" ? "Video call" : "Phone call"}
        </h1>
        <Badge variant={callStateBadgeVariant(call.state)}>{callStateLabel(call.state)}</Badge>
      </div>

      {incident && (
        <Link
          href={`/owner/incidents/${incident.id}` as never}
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Siren className="h-4 w-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Property" value={property?.name ?? "—"} />
        <Field label="Handled by" value={handler} />
        <Field label="Started" value={formatCallTime(call.ring_started_at, tz)} />
        <Field label="Duration" value={formatDuration(call.duration_seconds)} />
        <Field label="Caller" value={call.caller_number ?? "—"} />
        <Field label="Room" value={call.room_number ?? "—"} />
      </section>

      {call.notes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{call.notes}</p>
        </section>
      )}

      {/* Recording seam: dark until call recording ships (v1.1/v1.2). No code change needed then. */}
      {call.recording_url && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Recording</h2>
          <audio controls src={call.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(owner)/owner/calls/[id]/page.tsx"
git commit -m "feat(7a): owner call detail + dark recording seam"
```

---

### Task 11: Incidents list

**Files:**
- Create: `apps/portal/app/(owner)/owner/incidents/page.tsx`
- Create: `apps/portal/app/(owner)/owner/incidents/loading.tsx`

Read-only emergency list. AutoRefresh so a new 911 incident appears within 20s.

- [ ] **Step 1: Write the page**

Create `apps/portal/app/(owner)/owner/incidents/page.tsx`:

```tsx
import Link from "next/link";
import { Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { incidentStatusLabel, incidentStatusBadgeVariant, formatCallTime } from "@/lib/owner/format";
import { AutoRefresh } from "@/components/owner/auto-refresh";

export default async function OwnerIncidentsPage() {
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .eq("operator_id", actor.operator_id)
    .eq("owner_user_id", actor.id);
  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));

  const { data: incidents } = props.length
    ? await supabase
        .from("incidents")
        .select("id, property_id, status, dispatched_to, call_id, created_at")
        .in("property_id", props.map((p) => p.id))
        .order("created_at", { ascending: false })
    : { data: [] };
  const rows = incidents ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Incidents</h1>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border py-16 text-center">
          <Siren className="h-10 w-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No emergencies.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((i) => (
            <li key={i.id}>
              <Link
                href={`/owner/incidents/${i.id}` as never}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Siren className="h-4 w-4 text-destructive" aria-hidden="true" /> 911 Emergency
                  </span>
                  <span className="text-xs text-text-muted">
                    {nameById.get(i.property_id) ?? "—"} · {formatCallTime(i.created_at, tzById.get(i.property_id) ?? "UTC")} · dispatched to {i.dispatched_to}
                  </span>
                </div>
                <Badge variant={incidentStatusBadgeVariant(i.status)}>{incidentStatusLabel(i.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the loading skeleton**

Create `apps/portal/app/(owner)/owner/incidents/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerIncidentsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-32" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/incidents/page.tsx" "apps/portal/app/(owner)/owner/incidents/loading.tsx"
git commit -m "feat(7a): owner incidents list (read)"
```

---

### Task 12: Incident detail (read-only)

**Files:**
- Create: `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`

Full incident info + linked call + notes. **No resolve control** (that's 7b).

- [ ] **Step 1: Write the page**

Create `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { incidentStatusLabel, incidentStatusBadgeVariant, formatCallTime } from "@/lib/owner/format";

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default async function OwnerIncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole("OWNER");
  const supabase = await createServerClient();

  const { data: incident } = await supabase
    .from("incidents")
    .select("id, property_id, status, dispatched_to, call_id, notes, created_at, resolved_at")
    .eq("id", id)
    .maybeSingle();

  if (!incident) notFound();

  const { data: property } = await supabase
    .from("properties")
    .select("name, timezone")
    .eq("id", incident.property_id)
    .maybeSingle();
  const tz = property?.timezone ?? "UTC";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href="/owner/incidents" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Incidents
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">911 Emergency</h1>
        <Badge variant={incidentStatusBadgeVariant(incident.status)}>{incidentStatusLabel(incident.status)}</Badge>
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-5">
        <Field label="Property" value={property?.name ?? "—"} />
        <Field label="Dispatched to" value={incident.dispatched_to} />
        <Field label="Triggered" value={formatCallTime(incident.created_at, tz)} />
        <Field label="Resolved" value={incident.resolved_at ? formatCallTime(incident.resolved_at, tz) : "Not resolved"} />
      </section>

      {incident.call_id && (
        <Link
          href={`/owner/calls/${incident.call_id}` as never}
          className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm font-medium text-foreground hover:border-primary/40"
        >
          <Phone className="h-4 w-4" aria-hidden="true" /> View the originating call
        </Link>
      )}

      {incident.notes && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
          <h2 className="text-lg font-medium text-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">{incident.notes}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(owner)/owner/incidents/[id]/page.tsx"
git commit -m "feat(7a): owner incident detail (read)"
```

---

### Task 13: Full verification + docs + tag

**Files:**
- Modify: `memory/project-status.md` (add 7a section)
- Modify: `CLAUDE.md` (build-status table: fill the Plan 7 row / add a 7a row + tag)

- [ ] **Step 1: Full suite green**

Run (from `apps/portal/`): `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green, including the 3 new `tests/owner/*` files; existing test count unchanged otherwise.

- [ ] **Step 2: Manual smoke test**

Start the stack (`pnpm supabase:start` if not running, then from `apps/portal/`: `pnpm dev`). Sign in at `/sign-in` as **`owner@lobbyconnect.local` / `localdev123`** (seed OWNER Olivia, who owns "The Sample Hotel"). Verify:
- Lands on `/owner` (Home). One glance card: "The Sample Hotel", assigned agent **Alex Agent** with a presence dot, today's call count, and an open-incident badge iff a 6c incident is unresolved.
- Resize to 375px → bottom tab bar (Home / Calls / Incidents) is fixed and thumb-reachable; at ≥768px the bottom bar disappears and the top nav shows in the header.
- Tap the card → property detail. Confirm **no routing DID** is shown; kiosk fields render display-only; "Recent calls" preview links into call detail.
- **Calls** tab: reverse-chron list. If empty, place a real phone/kiosk call first, then confirm it appears (AutoRefresh updates within ~20s without a manual reload, or on tab focus). A `COMPLETED` call shows "Completed"; a `NO_ANSWER` shows "Missed" (destructive badge).
- Open a call → detail renders; the recording section is **absent** (recording_url null). If the call spawned a 6c incident, the "Emergency — view incident" link is present and navigates to the incident.
- **Incidents** tab: the 6c emergency appears with an Open/Resolved badge; detail shows dispatched-to (933 in dev), linked call, notes. No resolve control.
- Confirm an owner cannot reach another operator's data: visiting `/owner/calls/<some-other-call-id>` returns 404 (RLS → null → `notFound`).

- [ ] **Step 3: Update status docs**

In `memory/project-status.md`, add a "## Plan 7a — Owner portal (read views) — COMPLETE" section summarizing: shell + Home + property detail + calls + call detail + incidents (+detail), all read-only over existing RLS, zero migrations / zero new API routes / zero service-role; `lib/owner/` helpers TDD'd; recording seam dark; note **7b** is next (owner writes: kiosk edit, playbook upload, incident resolve).

In `CLAUDE.md`, update the build-status table: set the Plan 7 row (or add a `7a` row) to "Owner portal read views — shell + Home + properties/calls/incidents (read), `lib/owner/` helpers, AutoRefresh poller" with tag `plan-07a-owner-portal-complete`.

- [ ] **Step 4: Commit + tag**

```bash
git add memory/project-status.md CLAUDE.md
git commit -m "docs(7a): mark owner portal read-views complete + smoke checklist"
git tag plan-07a-owner-portal-complete
```

---

## Self-review notes (already reconciled against the spec)

- **Spec coverage:** shell+nav (T5/T6), Home glance cards w/ presence+today-count+open-incident (T1/T2/T7), property detail read incl. hidden DID (T8), call history w/ filter+load-more (T9), call detail + recording seam + incident link (T10), incidents list+detail read-only (T11/T12), AutoRefresh = locked-decision-4 polling (T4), skeleton loading states (T7/T9/T11). 7b items (kiosk edit / playbook upload / incident resolve) intentionally excluded.
- **Enum fidelity:** labels/variants cover exactly `CallState` (5), `IncidentStatus` (OPEN/RESOLVED), `ProfileStatus` (4) from `@lc/shared` — verified against `packages/shared/src/supabase-types.ts`.
- **Type consistency:** `BadgeVariant` defined once in `format.ts`; `OwnerTab` once in `nav.ts`; helper names referenced identically across pages (`callStateLabel`, `callStateBadgeVariant`, `formatCallTime`, `formatDuration`, `presenceDotClass`, `presenceLabel`, `countTodayCalls`, `countOpenIncidents`).
- **No new migration / route / service-role** — every read goes through the user-scoped client; RLS enforces owner scope; `notFound()` covers the not-yours case.
```
