# UI/UX Stage 2 — Agent/Admin Repaint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint the internal agent + admin portals to the locked brand system, turning the agent dashboard and admin overview into useful operational screens via light read-only queries.

**Architecture:** Pure data-derivation helpers (TDD) feed RSC server-component pages that compose reused owner-portal presentational components (`StatTile`, `StatusPill`, `SectionCard`) plus a small set of new shared dashboard components. The softphone + video overlay get chrome-only repaints (no logic change). A lightweight React context surfaces the softphone's existing connection `phase` to the agent greeting's line-status beacon. No writes, migrations, or new API routes.

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript, Tailwind v4 (`@theme` tokens from Stage 1), shadcn primitives, Vitest, Supabase (user-scoped RLS client), pnpm monorepo.

**Spec:** `docs/specs/2026-06-08-stage2-agent-admin-repaint-design.md`
**Dependency:** owner-portal repaint (PR #15) must be merged to `main` first (reuses `components/owner/*` + `lib/owner/*`). Cut this branch from `main` after #15 lands. *(Branch `feat/ui-ux-stage2-agent-admin` already exists with the spec committed.)*

---

## Conventions (read once)

- **Run a single test:** `cd apps/portal && pnpm test -- <path>` (e.g. `pnpm test -- tests/dashboard/calls.test.ts`). `pnpm test` = `vitest run`.
- **Gates:** `cd apps/portal && pnpm typecheck` · `pnpm lint` · `pnpm build`.
- **Tests live in** `apps/portal/tests/<area>/<name>.test.ts`; source under `apps/portal/lib/<area>/`. Import source via `@/lib/...`; shared types via `@lc/shared`.
- **No hardcoded hex** — only Tailwind brand tokens. **Reuse** before adding.
- **Reused as-is:** `StatTile`, `StatusPill`, `SectionCard` (`components/owner/`); `presenceDotClass`, `presenceLabel`, `isLivePresence`, `formatDuration`, `formatTimeOnly` (`lib/owner/format.ts`); `greetingForHour` (`@lc/shared`); `isStale`, `STALE_AFTER_MS` (`lib/voice/presence.ts`); `Card`, `Table`, `Switch`, `Badge`, `Skeleton`, `DropdownMenu`, `AlertDialog`, `Input`, `Select`, `Textarea`, `Label` (`components/ui/`); `UserMenu` (`components/user-menu.tsx`).

## File structure (created / modified)

**New (logic + shared components):**
- `lib/dashboard/calls.ts` — `countToday`, `avgPickupSeconds` (per-call timezone). Pure.
- `lib/dashboard/presence.ts` — `countOnlineAgents`. Pure.
- `lib/dashboard/line-status.ts` — `lineStatusFromPhase` (pure) + the `LineStatus` React context/provider/hook.
- `components/dashboard/greeting-line.tsx` — client greeting island ("Good evening, {name}.").
- `components/dashboard/line-beacon.tsx` — client mint/red line beacon (reads `LineStatus`).
- `tests/dashboard/{calls,presence,line-status}.test.ts` — unit tests.

**Modified (repaint / compose):**
- `app/(agent)/agent/page.tsx`, `app/(agent)/agent/loading.tsx` (new), `app/(agent)/layout.tsx`
- `components/softphone/softphone.tsx`
- `components/video-call/{video-call,incoming-video-banner,playbook-panel}.tsx`
- `app/(admin)/admin/page.tsx`, `app/(admin)/admin/loading.tsx` (new), `app/(admin)/admin/availability-cards.tsx`
- `app/(admin)/admin/users/users-table.tsx`, `.../users/loading.tsx` (new)
- `app/(admin)/admin/properties/properties-table.tsx`, `.../properties/loading.tsx` (new), `property-form.tsx`, `[id]/assignment-card.tsx`, `[id]/kiosk-link-card.tsx`
- `app/(admin)/admin/audit/audit-table.tsx`, `.../audit/loading.tsx` (new)
- `app/(admin)/admin/status/status-card.tsx`
- `components/app-sidebar.tsx`, `components/nav-item.tsx`, `components/user-menu.tsx`

---

## Task 1: Call-stat helpers (`lib/dashboard/calls.ts`)

Per-call timezone (each call judged "today" in its own property's tz), so multi-tz operators stay correct. Reuses the owner `isToday` approach.

**Files:**
- Create: `apps/portal/lib/dashboard/calls.ts`
- Test: `apps/portal/tests/dashboard/calls.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/portal/tests/dashboard/calls.test.ts
import { describe, it, expect } from "vitest";
import { countToday, avgPickupSeconds } from "@/lib/dashboard/calls";

const NOW = new Date("2026-06-08T02:00:00Z"); // 9:00 PM America/Chicago on Jun 7

describe("countToday", () => {
  it("counts items whose ring_started_at is 'today' in their own timezone", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", timeZone: "America/Chicago" }, // Jun 7 8pm CT -> today
      { ring_started_at: "2026-06-06T01:00:00Z", timeZone: "America/Chicago" }, // earlier -> no
      { ring_started_at: "2026-06-08T01:30:00Z", timeZone: "America/New_York" }, // Jun 7 9:30pm ET -> today
    ];
    expect(countToday(items, NOW)).toBe(2);
  });
  it("is 0 for empty", () => {
    expect(countToday([], NOW)).toBe(0);
  });
});

describe("avgPickupSeconds", () => {
  it("averages answered_at - ring_started_at over today's answered calls, rounded", () => {
    const items = [
      { ring_started_at: "2026-06-08T01:00:00Z", answered_at: "2026-06-08T01:00:10Z", timeZone: "America/Chicago" }, // 10s
      { ring_started_at: "2026-06-08T01:05:00Z", answered_at: "2026-06-08T01:05:20Z", timeZone: "America/Chicago" }, // 20s
      { ring_started_at: "2026-06-08T01:06:00Z", answered_at: null, timeZone: "America/Chicago" }, // unanswered -> ignored
    ];
    expect(avgPickupSeconds(items, NOW)).toBe(15);
  });
  it("returns null when there are no answered calls today", () => {
    expect(avgPickupSeconds([], NOW)).toBeNull();
    expect(
      avgPickupSeconds(
        [{ ring_started_at: "2026-06-08T01:00:00Z", answered_at: null, timeZone: "America/Chicago" }],
        NOW,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm test -- tests/dashboard/calls.test.ts`
Expected: FAIL — cannot find module `@/lib/dashboard/calls`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/portal/lib/dashboard/calls.ts

function localDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function isToday(iso: string, timeZone: string, now: Date): boolean {
  return localDateKey(iso, timeZone) === localDateKey(now.toISOString(), timeZone);
}

export type DatedCall = { readonly ring_started_at: string; readonly timeZone: string };

export function countToday(items: ReadonlyArray<DatedCall>, now: Date): number {
  return items.filter((c) => isToday(c.ring_started_at, c.timeZone, now)).length;
}

export type PickupCall = DatedCall & { readonly answered_at: string | null };

export function avgPickupSeconds(items: ReadonlyArray<PickupCall>, now: Date): number | null {
  const today = items.filter(
    (c) => c.answered_at != null && isToday(c.ring_started_at, c.timeZone, now),
  );
  if (today.length === 0) return null;
  const total = today.reduce(
    (sum, c) => sum + (Date.parse(c.answered_at as string) - Date.parse(c.ring_started_at)) / 1000,
    0,
  );
  return Math.round(total / today.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm test -- tests/dashboard/calls.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/dashboard/calls.ts apps/portal/tests/dashboard/calls.test.ts
git commit -m "feat(ui-ux): dashboard call-stat helpers (countToday, avgPickupSeconds)"
```

---

## Task 2: Online-agents helper (`lib/dashboard/presence.ts`)

Reuses `isStale` (90s window) + `isLivePresence` (AVAILABLE/ON_CALL).

**Files:**
- Create: `apps/portal/lib/dashboard/presence.ts`
- Test: `apps/portal/tests/dashboard/presence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/portal/tests/dashboard/presence.test.ts
import { describe, it, expect } from "vitest";
import { countOnlineAgents } from "@/lib/dashboard/presence";

const NOW = Date.parse("2026-06-08T02:00:00Z");
const fresh = "2026-06-08T01:59:30Z"; // 30s ago
const stale = "2026-06-08T01:50:00Z"; // 10m ago

describe("countOnlineAgents", () => {
  it("counts AVAILABLE/ON_CALL agents with a fresh last_seen_at", () => {
    const agents = [
      { status: "AVAILABLE", last_seen_at: fresh },
      { status: "ON_CALL", last_seen_at: fresh },
      { status: "AWAY", last_seen_at: fresh },       // not live
      { status: "AVAILABLE", last_seen_at: stale },  // stale
      { status: "AVAILABLE", last_seen_at: null },   // never seen
    ] as const;
    expect(countOnlineAgents(agents, NOW)).toBe(2);
  });
  it("is 0 for empty", () => {
    expect(countOnlineAgents([], NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm test -- tests/dashboard/presence.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/portal/lib/dashboard/presence.ts
import type { ProfileStatus } from "@lc/shared";
import { isStale } from "@/lib/voice/presence";
import { isLivePresence } from "@/lib/owner/format";

export type PresenceRow = {
  readonly status: ProfileStatus;
  readonly last_seen_at: string | null;
};

export function countOnlineAgents(agents: ReadonlyArray<PresenceRow>, now: number): number {
  return agents.filter((a) => isLivePresence(a.status) && !isStale(a.last_seen_at, now)).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm test -- tests/dashboard/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/dashboard/presence.ts apps/portal/tests/dashboard/presence.test.ts
git commit -m "feat(ui-ux): countOnlineAgents presence helper"
```

---

## Task 3: Line-status mapping + context (`lib/dashboard/line-status.ts`)

The softphone owns a `phase` state machine. This maps that phase to a beacon status and provides a tiny context so the agent greeting beacon can read it without touching call logic. The context default is a **no-op** so the shared softphone works unchanged in the admin layout (no provider there).

**Files:**
- Create: `apps/portal/lib/dashboard/line-status.ts`
- Test: `apps/portal/tests/dashboard/line-status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/portal/tests/dashboard/line-status.test.ts
import { describe, it, expect } from "vitest";
import { lineStatusFromPhase } from "@/lib/dashboard/line-status";

describe("lineStatusFromPhase", () => {
  it("up when the line can take calls", () => {
    expect(lineStatusFromPhase("ready")).toBe("up");
    expect(lineStatusFromPhase("incoming")).toBe("up");
    expect(lineStatusFromPhase("in-call")).toBe("up");
  });
  it("down while connecting or errored", () => {
    expect(lineStatusFromPhase("connecting")).toBe("down");
    expect(lineStatusFromPhase("error")).toBe("down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm test -- tests/dashboard/line-status.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/portal/lib/dashboard/line-status.ts
"use client";

import { createContext, useContext } from "react";

export type LinePhase = "connecting" | "ready" | "incoming" | "in-call" | "error";
export type LineStatus = "up" | "down";

export function lineStatusFromPhase(phase: LinePhase): LineStatus {
  return phase === "ready" || phase === "incoming" || phase === "in-call" ? "up" : "down";
}

/** Softphone pushes its phase here; the greeting beacon reads it. Default no-op
 *  so the shared softphone works in layouts without a provider (admin). */
export const LineStatusContext = createContext<{
  status: LineStatus;
  report: (phase: LinePhase) => void;
}>({ status: "down", report: () => {} });

export function useLineStatus() {
  return useContext(LineStatusContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm test -- tests/dashboard/line-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/dashboard/line-status.ts apps/portal/tests/dashboard/line-status.test.ts
git commit -m "feat(ui-ux): line-status phase mapping + context"
```

---

## Task 4: Shared dashboard components (greeting line + beacon + provider)

**Files:**
- Create: `apps/portal/components/dashboard/greeting-line.tsx`
- Create: `apps/portal/components/dashboard/line-beacon.tsx`
- Create: `apps/portal/components/dashboard/line-status-provider.tsx`

- [ ] **Step 1: Greeting line** (hydration-safe: stable SSR text, time-aware after mount — mirrors owner `Greeting`)

```tsx
// apps/portal/components/dashboard/greeting-line.tsx
"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@lc/shared";

export function GreetingLine({ firstName }: { readonly firstName: string }) {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);
  return (
    <h1 className="font-display text-2xl leading-tight text-foreground">
      {greeting}, {firstName}.
    </h1>
  );
}
```

- [ ] **Step 2: Line beacon** (mint solid = up, red flashing = down; flash disabled under reduced-motion via the `motion-reduce:` variant)

```tsx
// apps/portal/components/dashboard/line-beacon.tsx
"use client";

import { useLineStatus } from "@/lib/dashboard/line-status";
import { cn } from "@/lib/utils";

export function LineBeacon() {
  const { status } = useLineStatus();
  const up = status === "up";
  return (
    <span
      role="status"
      aria-label={up ? "Phone line connected" : "Phone line disconnected"}
      className={cn(
        "inline-block h-3 w-3 rounded-full",
        up
          ? "bg-live shadow-[0_0_0_3px_rgba(6,214,160,0.18)]"
          : "bg-destructive animate-pulse motion-reduce:animate-none",
      )}
    />
  );
}
```

- [ ] **Step 3: Provider** (holds status, exposes `report`; agent layout wraps main + rail in it)

```tsx
// apps/portal/components/dashboard/line-status-provider.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  LineStatusContext,
  lineStatusFromPhase,
  type LinePhase,
  type LineStatus,
} from "@/lib/dashboard/line-status";

export function LineStatusProvider({ children }: { readonly children: React.ReactNode }) {
  const [status, setStatus] = useState<LineStatus>("down");
  const report = useCallback((phase: LinePhase) => setStatus(lineStatusFromPhase(phase)), []);
  const value = useMemo(() => ({ status, report }), [status, report]);
  return <LineStatusContext.Provider value={value}>{children}</LineStatusContext.Provider>;
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `cd apps/portal && pnpm typecheck`
Expected: PASS (no usages yet, but types resolve).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/dashboard/
git commit -m "feat(ui-ux): shared dashboard greeting line, line beacon, provider"
```

---

## Task 5: Agent dashboard page + loading

Rebuild `app/(agent)/agent/page.tsx` as an RSC that reads agent-scoped data and composes the locked layout. Covering list = plain names. Stats = Today / Avg pickup / Missed. (No kiosk dots here.)

**Files:**
- Modify: `apps/portal/app/(agent)/agent/page.tsx`
- Create: `apps/portal/app/(agent)/agent/loading.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// apps/portal/app/(agent)/agent/page.tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { LineBeacon } from "@/components/dashboard/line-beacon";
import { countToday, avgPickupSeconds } from "@/lib/dashboard/calls";
import { formatDuration, formatTimeOnly } from "@/lib/owner/format";

export default async function AgentDashboardPage() {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();
  const now = new Date();

  // Active primary assignments -> covered property ids + names.
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id, properties(name, timezone)")
    .eq("primary_agent_id", actor.id)
    .is("effective_until", null);

  const covered = (assignments ?? []).map((a) => ({
    id: a.property_id,
    name: (a.properties as { name: string } | null)?.name ?? "—",
    timeZone: (a.properties as { timezone: string } | null)?.timezone ?? "UTC",
  }));
  const coveredIds = covered.map((c) => c.id);
  const tzById = new Map(covered.map((c) => [c.id, c.timeZone]));

  // Calls I handled in the last 48h (wide enough for any tz's "today").
  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const { data: handledRaw } = await supabase
    .from("calls")
    .select("id, property_id, ring_started_at, answered_at, room_number, properties(name, timezone)")
    .eq("handled_by_user_id", actor.id)
    .gte("ring_started_at", since)
    .order("ring_started_at", { ascending: false });

  const handled = (handledRaw ?? []).map((c) => ({
    id: c.id,
    ring_started_at: c.ring_started_at,
    answered_at: c.answered_at,
    room_number: c.room_number,
    propertyName: (c.properties as { name: string } | null)?.name ?? "—",
    timeZone: (c.properties as { timezone: string } | null)?.timezone ?? "UTC",
  }));

  const todayCount = countToday(handled, now);
  const avgPickup = avgPickupSeconds(handled, now);

  // Missed = NO_ANSWER calls at my covered properties today (per-property tz).
  let missed = 0;
  if (coveredIds.length > 0) {
    const { data: noAns } = await supabase
      .from("calls")
      .select("property_id, ring_started_at")
      .in("property_id", coveredIds)
      .eq("state", "NO_ANSWER")
      .gte("ring_started_at", since);
    missed = countToday(
      (noAns ?? []).map((c) => ({
        ring_started_at: c.ring_started_at,
        timeZone: tzById.get(c.property_id) ?? "UTC",
      })),
      now,
    );
  }

  const firstName = actor.full_name.split(/\s+/)[0] ?? actor.full_name;
  const recent = handled.slice(0, 5);

  return (
    <div className="flex items-stretch gap-4 animate-fade-up">
      {/* MAIN */}
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex min-h-[13rem] flex-col gap-3">
          <Card className="relative gap-1 p-5">
            <span className="absolute right-5 top-5"><LineBeacon /></span>
            <GreetingLine firstName={firstName} />
            <p className="text-sm text-text-muted">Covering {covered.length} properties</p>
          </Card>
          <div className="flex flex-1 gap-3">
            <StatTile value={todayCount} label="Today" />
            <StatTile value={formatDuration(avgPickup)} label="Avg pickup" />
            <StatTile value={missed} label="Missed" alert={missed > 0} />
          </div>
        </div>
        <Card className="flex-1 gap-2 p-5">
          <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            Recent calls
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">No calls handled yet.</p>
          ) : (
            <ul className="flex flex-col">
              {recent.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"
                >
                  <span className="text-foreground">
                    {c.room_number ? `Room ${c.room_number}` : "Lobby"} · {c.propertyName}
                  </span>
                  <span className="font-mono text-xs text-text-muted">
                    {formatTimeOnly(c.ring_started_at, c.timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* RAIL note: the Softphone + Properties list live in app/(agent)/layout.tsx
          aside (Task 6). This page renders only the main column. */}
    </div>
  );
}
```

> **Note on `formatDuration`:** `formatDuration(11)` → `"11s"`, `formatDuration(null)` → `"—"`, `formatDuration(65)` → `"1m 5s"` (verified in `lib/owner/format.ts`). Perfect for Avg pickup.

- [ ] **Step 2: Implement loading skeleton**

```tsx
// apps/portal/app/(agent)/agent/loading.tsx
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex gap-4">
      <div className="flex flex-1 flex-col gap-3">
        <Card className="gap-2 p-5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </Card>
        <div className="flex gap-3">
          <Skeleton className="h-16 flex-1 rounded-input" />
          <Skeleton className="h-16 flex-1 rounded-input" />
          <Skeleton className="h-16 flex-1 rounded-input" />
        </div>
        <Skeleton className="h-48 w-full rounded-card" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify gates**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`
Expected: PASS. (If the Supabase nested-select typing is awkward, keep the `as { name: string } | null` casts shown.)

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/\(agent\)/agent/page.tsx apps/portal/app/\(agent\)/agent/loading.tsx
git commit -m "feat(ui-ux): agent dashboard — greeting, stats, recent calls"
```

---

## Task 6: Agent layout — header UserMenu, seam hairline, rail (softphone + coverage), line-status provider

The layout owns the right rail (softphone + coverage list) and wraps everything in `LineStatusProvider` so the beacon (page) and softphone (rail) share line status. Coverage list = plain property names (re-query here; it's cheap and keeps the page/rail decoupled).

**Files:**
- Modify: `apps/portal/app/(agent)/layout.tsx`

- [ ] **Step 1: Rewrite the layout**

```tsx
// apps/portal/app/(agent)/layout.tsx
import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { Wordmark } from "@/components/brand/wordmark";
import { UserMenu } from "@/components/user-menu";
import { Card } from "@/components/ui/card";
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";

export default async function AgentLayout({ children }: { readonly children: React.ReactNode }) {
  const actor = await requireRole("AGENT");
  const supabase = await createServerClient();

  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("properties(name)")
    .eq("primary_agent_id", actor.id)
    .is("effective_until", null);
  const coverage = (assignments ?? [])
    .map((a) => (a.properties as { name: string } | null)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <LineStatusProvider>
      <div className="min-h-screen bg-background">
        <header className="flex items-center justify-between border-b border-border bg-gradient-to-r from-transparent to-transparent px-6 py-3 [border-image:var(--gradient-seam)_1] [border-image-slice:0_0_1_0]">
          <Link href="/agent" aria-label="Lobby Connect home"><Wordmark /></Link>
          <UserMenu fullName={actor.full_name} email={actor.email} role="AGENT" />
        </header>
        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
          <main>{children}</main>
          <aside className="flex flex-col gap-3">
            <Softphone role="AGENT" />
            <VideoCallHost />
            <Card className="gap-2 p-4">
              <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                Properties you cover
              </h2>
              {coverage.length === 0 ? (
                <p className="text-sm text-text-muted">No properties assigned.</p>
              ) : (
                <ul className="flex flex-col">
                  {coverage.map((name) => (
                    <li key={name} className="border-b border-border py-2 text-sm text-foreground last:border-0">
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </aside>
        </div>
      </div>
    </LineStatusProvider>
  );
}
```

> **Seam hairline:** the `[border-image:var(--gradient-seam)_1]` utility paints the bottom border with the seam gradient. If the arbitrary-property syntax fights Tailwind v4, fall back to a 1px child `<div className="h-px w-full" style={{background:"var(--gradient-seam)"}} />` under the header — but try the border-image first (matches owner header).

- [ ] **Step 2: Verify gates + that the seam renders**

Run: `cd apps/portal && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/app/\(agent\)/layout.tsx
git commit -m "feat(ui-ux): agent layout — UserMenu, seam header, coverage rail, line-status provider"
```

---

## Task 7: Softphone repaint — beacon reporting, line dot, incoming/in-call, relocated 911

Chrome only. Report `phase` to the line-status context; recolor the connection dot to mint/grey; restyle incoming (mint Accept) + in-call (seam edge, coral Hang up); move Emergency below the notes as a divided solid-red button; reword the dialog; swap hardcoded reds for `destructive` tokens.

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx`

- [ ] **Step 1: Report phase to the line-status context** — add near the other hooks:

```tsx
import { useLineStatus } from "@/lib/dashboard/line-status";
// ...inside Softphone(), after `const [phase, setPhase] = useState<Phase>("connecting");`
const { report } = useLineStatus();
useEffect(() => {
  report(phase);
}, [phase, report]);
```

(`Phase` already matches `LinePhase`. In the admin layout there's no provider, so `report` is the context default no-op — safe.)

- [ ] **Step 2: Recolor the connection dot** — in `ConnectionDot`, change the ok/!ok classes:

```tsx
className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-live" : "bg-muted-foreground/40"}`}
```

- [ ] **Step 3: Incoming — mint Accept.** Change the Accept button class from `bg-primary text-primary-foreground` to:

```tsx
className="flex flex-1 items-center justify-center gap-2 rounded-button bg-live px-3 py-2 text-live-foreground"
```

(Decline stays outline.)

- [ ] **Step 4: In-call — seam edge + coral Hang up + relocated Emergency.** Replace the in-call control row so the row holds only **Mute + Hang up**, and add the **Emergency** block (divided, below the notes). Apply a seam edge to the in-call container.
  - Container: add a seam edge to the in-call wrapper `div` (the `mt-3 space-y-3` block) → wrap its parent card region or add `className="... [border-image:var(--gradient-seam)_1]"`. Simplest: keep the outer card; add a top hairline `<div className="h-px w-full" style={{ background: "var(--gradient-seam)" }} />` at the top of the in-call block.
  - Control row → Mute (outline, unchanged) + Hang up:

```tsx
<button type="button" onClick={() => void endCall()}
  className="flex flex-1 items-center justify-center gap-2 rounded-button bg-accent-strong px-3 py-2 text-accent-foreground">
  <PhoneOff size={16} /> Hang up
</button>
```

  - Move the `AlertDialog` (Emergency) OUT of that row to **below** the Room#/notes inputs, separated by a divider, full-width solid red:

```tsx
<hr className="my-3 border-border" />
<AlertDialog>
  <AlertDialogTrigger asChild>
    <button type="button" disabled={emergencyActive}
      className="flex w-full items-center justify-center gap-2 rounded-button bg-destructive px-3 py-2 font-medium text-destructive-foreground disabled:opacity-50">
      <AlertTriangle size={16} /> {emergencyActive ? "911 active" : "Call 911 — emergency"}
    </button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Call emergency services (911)?</AlertDialogTitle>
      <AlertDialogDescription>
        This conferences 911 into the live call — the guest, you, and the dispatcher on one line — and logs a high-priority incident.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      Not life-threatening? Cancel and use the property&apos;s local non-emergency number instead. Only continue for a genuine emergency.
    </div>
    {/* FORWARD-COMPAT SEAM: when the on-call-manager notify feature lands (cut from v1),
        add an "also alerts the admin, owner, and property GM" line to the description above.
        Do not render it until the backend actually sends those alerts. */}
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => void triggerEmergency()}
        className="bg-destructive text-destructive-foreground">
        Yes — call 911
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Tokenize the emergency status banners.** Replace the two hardcoded-red `<p>` blocks (`border-red-300 bg-red-50 text-red-700` / `border-red-500 bg-red-100 text-red-800`) with destructive tokens:

```tsx
// active (not failed):
className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
// failed:
className="rounded-input border border-destructive bg-destructive/15 px-3 py-2 text-sm font-medium text-destructive"
```

- [ ] **Step 6: Verify gates + existing softphone tests still pass**

Run: `cd apps/portal && pnpm test -- tests/ && pnpm typecheck && pnpm lint`
Expected: PASS (no softphone logic changed; if a snapshot/test asserts old class names, update it).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/components/softphone/softphone.tsx
git commit -m "feat(ui-ux): softphone repaint — line beacon report, mint Accept, coral Hang up, relocated 911 + reworded dialog"
```

---

## Task 8: Video-call overlay + incoming banner + playbook skeleton

Chrome only (Agora logic untouched). Header (connected dot + hotel + mono timer), 40/60 split on `--color-call`, seam-framed PiP, branded playbook loading skeleton, coral End, greyed Hold/Swap. Incoming banner matches the softphone incoming state.

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`
- Modify: `apps/portal/components/video-call/incoming-video-banner.tsx`
- Modify: `apps/portal/components/video-call/playbook-panel.tsx`

- [ ] **Step 1: video-call.tsx — header + split + control bar.** Replace the outer JSX structure:
  - Add a header strip above the body:

```tsx
<div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
    <span className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_rgba(6,214,160,0.18)]" />
    On video
  </span>
  {/* timer is optional in v1; if no elapsed-time state exists, omit rather than add logic */}
</div>
```

  - Guest video panel bg `bg-neutral-900` → `bg-[var(--color-call)]`; the PiP border → seam frame:

```tsx
<div ref={localRef}
  className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-md border-2 [border-image:var(--gradient-seam)_1]" />
```

  - Control bar: keep inputs; restyle Mute/Cam as outline, **End → coral**, keep Hold/Swap disabled but token-muted:

```tsx
// End button:
className="flex items-center gap-1 rounded-button bg-accent-strong px-3 py-2 text-sm text-accent-foreground"
// Hold/Swap (disabled): className="rounded-button border border-border px-3 py-2 text-sm text-muted-foreground opacity-50"
```

- [ ] **Step 2: incoming-video-banner.tsx — match softphone incoming.** Replace the banner body:

```tsx
<div className="rounded-card border border-border bg-card p-4 text-sm">
  <div className="flex items-center gap-2 font-medium text-foreground">
    <span className="inline-block h-2 w-2 rounded-full bg-live animate-pulse motion-reduce:animate-none" />
    <Video size={16} /> Incoming video · {call!.propertyName}
  </div>
  <button type="button" onClick={() => onAccept(call!)}
    className="mt-3 w-full rounded-button bg-live px-3 py-2 text-live-foreground">
    Accept video call
  </button>
</div>
```

- [ ] **Step 3: playbook-panel.tsx — branded loading skeleton.** Replace the loading state with shimmer lines (respect reduced-motion). Keep the `sandbox`-less iframe. Example loading block:

```tsx
<div className="flex h-full flex-col gap-2 bg-background p-4">
  <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
  {[100, 95, 88, 70, 100, 80].map((w, i) => (
    <div key={i} className="h-3 animate-pulse rounded bg-muted motion-reduce:animate-none" style={{ width: `${w}%` }} />
  ))}
</div>
```

(Empty + error states: reuse `text-text-muted` + a "Open in new tab" link, restyled to tokens. Do NOT re-add the iframe `sandbox` attribute — Chrome's PDF viewer won't render inside it.)

- [ ] **Step 4: Verify gates + tests**

Run: `cd apps/portal && pnpm test -- tests/ && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (playbook route tests unaffected; update any class-name assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/video-call/
git commit -m "feat(ui-ux): video overlay repaint — seam header/PiP, deep-navy stage, playbook skeleton, coral End"
```

---

## Task 9: Admin overview — operations board

Replace the link cards with: serif greeting + descriptor, a stat strip (Agents online · Calls today · Open incidents · Accepting), and a properties ops table (Property · Primary agent + presence · Calls today · Covering toggle). **No Kiosk column** (heartbeat is a no-op — not readable without a write; see Open Items). The "Covering" toggle reuses the existing `AvailabilityCards` write logic, refactored into table rows.

**Files:**
- Modify: `apps/portal/app/(admin)/admin/page.tsx`
- Modify: `apps/portal/app/(admin)/admin/availability-cards.tsx` (add an inline-row variant or a shared `AvailabilityToggle`)
- Create: `apps/portal/app/(admin)/admin/loading.tsx`

- [ ] **Step 1: Extract a reusable toggle** from `availability-cards.tsx` so the table can embed it. Add (keep `AvailabilityCards` exported for back-compat if referenced elsewhere; otherwise replace its usage):

```tsx
// apps/portal/app/(admin)/admin/availability-cards.tsx  (add this export)
"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setCallAvailabilityAction } from "./properties/actions";

export function AvailabilityToggle({
  propertyId, propertyName, initial,
}: { readonly propertyId: string; readonly propertyName: string; readonly initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();
  function toggle(next: boolean) {
    setOn(next);
    startTransition(async () => {
      const result = await setCallAvailabilityAction(propertyId, next);
      if (!result.ok) { setOn(!next); toast.error(result.error); }
    });
  }
  return (
    <Switch checked={on} onCheckedChange={toggle} aria-label={`Accept calls for ${propertyName}`} />
  );
}
```

- [ ] **Step 2: Rewrite the admin overview page**

```tsx
// apps/portal/app/(admin)/admin/page.tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { AvailabilityToggle } from "./availability-cards";
import { countToday } from "@/lib/dashboard/calls";
import { countOnlineAgents } from "@/lib/dashboard/presence";
import { presenceDotClass, presenceLabel } from "@/lib/owner/format";
import { cn } from "@/lib/utils";
import type { ProfileStatus } from "@lc/shared";

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();
  const now = new Date();

  const [{ data: properties }, { data: agents }, { data: incidents }, { data: avail }, { data: assigns }] =
    await Promise.all([
      supabase.from("properties").select("id, name, timezone").eq("operator_id", actor.operator_id).eq("active", true).order("name"),
      supabase.from("profiles").select("status, last_seen_at").eq("operator_id", actor.operator_id).eq("role", "AGENT").eq("active", true),
      supabase.from("incidents").select("id").eq("operator_id", actor.operator_id).eq("status", "OPEN"),
      supabase.from("admin_call_availability").select("property_id, accepting_calls").eq("profile_id", actor.id),
      supabase.from("property_assignments").select("property_id, profiles:primary_agent_id(full_name, status)").eq("operator_id", actor.operator_id).is("effective_until", null),
    ]);

  // Calls in the last 48h for today-counting per property tz.
  const since = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const { data: calls } = await supabase
    .from("calls").select("property_id, ring_started_at").eq("operator_id", actor.operator_id).gte("ring_started_at", since);

  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const callsWithTz = (calls ?? []).map((c) => ({ ring_started_at: c.ring_started_at, timeZone: tzById.get(c.property_id) ?? "UTC", property_id: c.property_id }));

  const onlineAgents = countOnlineAgents(agents ?? [], now.getTime());
  const callsToday = countToday(callsWithTz, now);
  const openIncidents = (incidents ?? []).length;
  const acceptingMap = new Map((avail ?? []).map((a) => [a.property_id, a.accepting_calls]));
  const acceptingCount = props.filter((p) => acceptingMap.get(p.id)).length;
  const agentByProperty = new Map(
    (assigns ?? []).map((a) => [a.property_id, a.profiles as { full_name: string; status: ProfileStatus } | null]),
  );
  const todayByProperty = (id: string) =>
    countToday(callsWithTz.filter((c) => c.property_id === id), now);

  const firstName = actor.full_name.split(/\s+/)[0] ?? actor.full_name;

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      <header className="flex flex-col gap-1">
        <GreetingLine firstName={firstName} />
        <p className="text-sm text-text-muted">Admin overview — users, properties, and call coverage for your operator.</p>
      </header>

      <div className="flex gap-3">
        <StatTile value={onlineAgents} label="Agents online" />
        <StatTile value={callsToday} label="Calls today" />
        <StatTile value={openIncidents} label="Open incidents" alert={openIncidents > 0} />
        <StatTile value={`${acceptingCount}/${props.length}`} label="Accepting" />
      </div>

      <Card className="gap-3 p-5">
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">Properties</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Property</TableHead>
              <TableHead>Primary agent</TableHead>
              <TableHead>Calls today</TableHead>
              <TableHead>Covering</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.map((p) => {
              const agent = agentByProperty.get(p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                  <TableCell>
                    {agent ? (
                      <span className="inline-flex items-center gap-2">
                        <span className={cn("inline-block h-2 w-2 rounded-full", presenceDotClass(agent.status))} />
                        {agent.full_name}
                        <span className="text-xs text-text-muted">{presenceLabel(agent.status)}</span>
                      </span>
                    ) : (
                      <span className="text-text-muted">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{todayByProperty(p.id)}</TableCell>
                  <TableCell>
                    <AvailabilityToggle propertyId={p.id} propertyName={p.name} initial={acceptingMap.get(p.id) ?? false} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Admin loading skeleton**

```tsx
// apps/portal/app/(admin)/admin/loading.tsx
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-64" />
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 flex-1 rounded-input" />)}
      </div>
      <Card className="gap-3 p-5"><Skeleton className="h-48 w-full" /></Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify gates**

Run: `cd apps/portal && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. (Nested `profiles:primary_agent_id(...)` may need the `as ... | null` cast shown.)

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/page.tsx apps/portal/app/\(admin\)/admin/availability-cards.tsx apps/portal/app/\(admin\)/admin/loading.tsx
git commit -m "feat(ui-ux): admin overview — operations board (stat strip + properties ops table)"
```

---

## Task 10: Admin tables, status page, detail cards, forms

Mechanical token/composition repaint. Zebra on the dense audit table; hairline elsewhere; filled `StatusPill`s; `SectionCard` chrome on detail pages; Stage 1 form primitives; status-card token swap.

**Files:**
- Modify: `users-table.tsx`, `properties-table.tsx`, `audit-table.tsx`, `property-form.tsx`, `[id]/assignment-card.tsx`, `[id]/kiosk-link-card.tsx`, `status/status-card.tsx`
- Create: `users/loading.tsx`, `properties/loading.tsx`, `audit/loading.tsx`

- [ ] **Step 1: Status-card token swap.** In `status/status-card.tsx`, replace the hardcoded dot colors:
  - `bg-emerald-500` → `bg-live`
  - `bg-amber-500` → `bg-accent` (coral = degraded; no new amber token)
  - `bg-red-500` → `bg-destructive`
  - `bg-muted-foreground/40` → keep (unknown)

- [ ] **Step 2: Tables.** Ensure each uses the Stage 1 `Table` primitive with `font-label` uppercase headers. Add zebra to the **audit** table body rows only:

```tsx
// audit-table.tsx rows:
<TableRow className="even:bg-muted/40">…</TableRow>
```

  Users/properties keep plain hairline rows (the `Table` primitive default).

- [ ] **Step 3: Status pills.** In `users-table.tsx`, render role + status as filled pills (mirror the owner `StatusPill` styling; role/user-status aren't in the owner union, so use inline pill classes):

```tsx
// role pill:
<span className="inline-flex items-center rounded-pill px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em] bg-muted text-foreground">{role}</span>
// user status: Active -> bg-live/15 text-live-foreground; Pending setup -> bg-accent/15 text-accent-strong; Deactivated -> bg-muted text-muted-foreground
```

  In `properties-table.tsx`, Active/Inactive as the same pill pattern (Active → live, Inactive → muted).

- [ ] **Step 4: Detail-page SectionCards.** In `[id]/assignment-card.tsx` and `[id]/kiosk-link-card.tsx`, wrap the content in `SectionCard` (`title` = "Primary agent" / "Kiosk device link", `action` slot for the buttons). Replace ad-hoc card divs. In `property-form.tsx`, ensure all fields use `Input`/`Select`/`Textarea`/`Label`/`Switch` from `components/ui/` (no raw `<input>`).

- [ ] **Step 5: Loading skeletons** for users/properties/audit (mirror the owner calls `loading.tsx`):

```tsx
// e.g. apps/portal/app/(admin)/admin/users/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      {[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-12 w-full rounded-card" />)}
    </div>
  );
}
```

  (Repeat for `properties/loading.tsx` and `audit/loading.tsx`.)

- [ ] **Step 6: Empty states.** Confirm `properties-table` / `users-table` / `audit-table` empty branches render a dashed-border + icon + plain message (e.g. "No properties yet — add your first hotel.").

- [ ] **Step 7: Verify gates + full suite**

Run: `cd apps/portal && pnpm test -- tests/ && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS (update any class-name assertions in existing table tests).

- [ ] **Step 8: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/
git commit -m "feat(ui-ux): admin tables/status/detail repaint — zebra audit, status pills, section cards, token status dots, loading states"
```

---

## Task 11: Shared chrome — sidebar active state, user menu, admin header seam

**Files:**
- Modify: `components/app-sidebar.tsx`, `components/nav-item.tsx`, `components/user-menu.tsx`, `app/(admin)/layout.tsx`

- [ ] **Step 1: Active nav = coral.** In `nav-item.tsx`, the active state uses coral: active → `bg-accent/10 text-accent-strong`, idle → `text-foreground hover:bg-muted`. (Keep the existing `--color-sidebar-*` aliases from Stage 1.)

- [ ] **Step 2: Admin header seam hairline.** In `app/(admin)/layout.tsx`, add the same seam bottom-border to the header strip as the agent layout (Task 6 Step 1).

- [ ] **Step 3: User menu polish.** In `user-menu.tsx`, recolor the initials badge to `bg-primary text-primary-foreground` (already) and ensure the role `Badge` reads on-brand; no logic change (keep the requestSubmit sign-out pattern).

- [ ] **Step 4: Verify gates + build**

Run: `cd apps/portal && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/app-sidebar.tsx apps/portal/components/nav-item.tsx apps/portal/components/user-menu.tsx apps/portal/app/\(admin\)/layout.tsx
git commit -m "feat(ui-ux): shared chrome — coral active nav, admin seam header, user menu polish"
```

---

## Task 12: Final verification, visual pass, tag

- [ ] **Step 1: Full gate**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: ALL PASS. Also run `pnpm test` at repo root for the shared package.

- [ ] **Step 2: Visual pass (dev server).** Eyeball: agent dashboard (idle; line beacon mint, then kill the softphone token route to see red flash), agent audio in-call (mint Accept → seam edge → coral Hang up → divided red 911 → reworded dialog), incoming + active video (deep-navy stage, seam PiP, playbook skeleton → PDF, coral End), admin overview (stat strip + ops table + covering toggle), each admin table (audit zebra), status page (mint/coral/red dots), property detail (SectionCards + form), sidebar active = coral. Toggle OS "reduce motion" and confirm the glow/flash/pulse/shimmer all stop.

- [ ] **Step 3: No-hex check.**

Run: `cd apps/portal && grep -rnE "#[0-9a-fA-F]{3,6}" app components | grep -v "//"` → expect no new literals in the files this plan touched (the deep-navy is the `--color-call` token).

- [ ] **Step 4: Commit any visual fixes, then tag.**

```bash
git commit -am "fix(ui-ux): stage-2 agent/admin visual pass" # if needed
git tag plan-stage2-agent-admin-complete
```

---

## Self-review notes (coverage check vs spec)

- §3 Agent dashboard → Tasks 4,5,6 (greeting+beacon, stats, recent calls, coverage rail, glow ring lives in softphone Task 7's idle state — *note:* the decorative rotating glow ring on the softphone idle state is a softphone visual; add it in Task 7 Step 4's idle/ready branch as a seam ring with `animate-spin`-style slow rotation + `motion-reduce:animate-none`). **Add to Task 7:** idle "Ready" gets the seam glow ring.
- §4 Admin overview → Task 9 (kiosk-online **dropped** — documented).
- §5 Softphone → Task 7. §6 Video → Task 8.
- §7 Tables/status/detail/states → Task 10. §8 Shared chrome → Tasks 6,11. §9 a11y/motion → reduced-motion in Tasks 4,8,10,12.
- Open items: (1) kiosk-online **resolved → dropped**; (2) Missed → property-scoped NO_ANSWER (Task 5); (3) phase sharing → context (Tasks 3,4,7); (4) owner dep → noted; (5) notify seam → Task 7 comment; (6) Solitude W → separate task.

> **Task 7 addendum (idle glow ring):** in the softphone's idle/Ready branch, render the seam ring with a soft rotating glow as the card's anchor (decorative, not a status indicator): a `rounded-full` element with `background: var(--gradient-seam)`, blurred, `animate-[spin_6s_linear_infinite] motion-reduce:animate-none`, behind a white inner ring. Mirrors the locked mockup.

---

## Execution

Recommended: **subagent-driven** (fresh implementer per task, two-stage review), matching the kiosk + owner repaints. Tasks 1–4 are independent and can run first; 5–6 depend on 4; 7 depends on 3; 9 depends on 1–2; 10–11 are independent repaints; 12 last.
