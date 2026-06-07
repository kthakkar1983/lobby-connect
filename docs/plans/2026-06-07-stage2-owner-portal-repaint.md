# UI/UX Stage 2 — Owner Portal Repaint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint every owner-portal screen (and the kiosk Home greeting) to the locked premium brand
direction at the token/composition layer — no route, data, RLS, or API changes.

**Architecture:** Add a tiny set of pure helpers (`greetingForHour`, status-pill mapping, day-grouping,
last-call) + reusable owner presentational components (`StatTile`, `StatusPill`, `SectionCard`, `Greeting`
island, `CallRow`, `IncidentRow`), then recompose each page onto them. All reads stay user-scoped; RLS
unchanged. Light mode, mobile-first.

**Tech Stack:** Next.js App Router (RSC + a few client islands), Tailwind v4 `@theme` brand tokens, shadcn
primitives (Stage 1 re-skin), Vitest, pnpm workspaces (`@lc/shared`). Kiosk is a Vite SPA sharing
`@lc/shared`.

**Spec:** `docs/specs/2026-06-07-stage2-owner-portal-repaint-design.md`.

**Branch:** `feat/ui-ux-stage2-owner` (already created off `main`; spec already committed there).

---

## Conventions for every task

- Run commands from the repo root: `/Users/kumarthakkar/Documents/Claude/Projects/Lobby Connect`.
- Tests: `pnpm --filter @lc/portal test <path>` (portal) or `pnpm --filter @lc/shared test` (shared). Full
  gate at the end: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **No hardcoded hex** — only brand token utilities (`text-foreground`, `bg-card`, `text-accent-strong`,
  `bg-live`, `text-destructive`, `border-border`, `font-display`, `font-mono`, `font-label`, etc.).
- Commit after each task with the message shown.

**Available brand token utility classes** (from `apps/portal/app/globals.css` `@theme`):
`bg-background text-foreground bg-card text-card-foreground bg-primary text-primary text-primary-foreground
bg-secondary bg-muted text-muted-foreground text-text-muted bg-accent text-accent bg-accent-strong
text-accent-strong bg-live text-live text-live-foreground bg-destructive text-destructive border-border
ring-ring font-display font-mono font-label shadow-sm shadow-md` and `bg-[image:var(--gradient-seam)]` for
the seam hairline.

---

## Task 1: `greetingForHour` shared helper

**Files:**
- Create: `packages/shared/src/greeting.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/greeting.test.ts` (create; if `packages/shared` has no test dir yet, this
  creates it — Vitest picks up `**/*.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/greeting.test.ts
import { describe, it, expect } from "vitest";
import { greetingForHour } from "../src/greeting";

describe("greetingForHour", () => {
  it("morning for 0..10", () => {
    for (const h of [0, 5, 10]) expect(greetingForHour(h)).toBe("Good morning");
  });
  it("afternoon for 11..16", () => {
    for (const h of [11, 13, 16]) expect(greetingForHour(h)).toBe("Good afternoon");
  });
  it("evening for 17..23", () => {
    for (const h of [17, 20, 23]) expect(greetingForHour(h)).toBe("Good evening");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lc/shared test greeting`
Expected: FAIL — cannot find module `../src/greeting`.

(If `@lc/shared` has no `test` script, run `pnpm --filter @lc/shared exec vitest run greeting` instead, and
verify a `test` script exists in `packages/shared/package.json`; if missing, add `"test": "vitest run"`.)

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/greeting.ts
/** Time-of-day greeting from a 24h hour (0–23). Caller passes local hour. */
export function greetingForHour(hour: number): string {
  if (hour <= 10) return "Good morning";
  if (hour <= 16) return "Good afternoon";
  return "Good evening";
}
```

- [ ] **Step 4: Export from the barrel**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./greeting";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lc/shared test greeting`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/greeting.ts packages/shared/src/index.ts packages/shared/tests/greeting.test.ts packages/shared/package.json
git commit -m "feat(shared): greetingForHour time-of-day helper"
```

---

## Task 2: Brand-token presence dots, live-presence helper, time-only formatter

**Files:**
- Modify: `apps/portal/lib/owner/format.ts`
- Test: `apps/portal/tests/owner/format.test.ts`

- [ ] **Step 1: Update the failing test first**

In `apps/portal/tests/owner/format.test.ts`, replace any existing `presenceDotClass` assertions and add the
new helpers. Add this block (and delete old `bg-emerald-500`/`bg-blue-500`/etc. expectations for
`presenceDotClass` if present):

```ts
import {
  presenceDotClass,
  isLivePresence,
  formatTimeOnly,
} from "@/lib/owner/format";

describe("presenceDotClass (brand tokens)", () => {
  it("maps to brand tokens", () => {
    expect(presenceDotClass("AVAILABLE")).toBe("bg-live");
    expect(presenceDotClass("ON_CALL")).toBe("bg-accent");
    expect(presenceDotClass("AWAY")).toBe("bg-muted-foreground");
    expect(presenceDotClass("OFFLINE")).toBe("bg-border");
  });
});

describe("isLivePresence", () => {
  it("true only for AVAILABLE/ON_CALL", () => {
    expect(isLivePresence("AVAILABLE")).toBe(true);
    expect(isLivePresence("ON_CALL")).toBe(true);
    expect(isLivePresence("AWAY")).toBe(false);
    expect(isLivePresence("OFFLINE")).toBe(false);
  });
});

describe("formatTimeOnly", () => {
  it("formats hour:minute in tz", () => {
    // 2026-06-07T02:42:00Z == 21:42 (9:42 PM) the prior day in America/Chicago
    expect(formatTimeOnly("2026-06-07T02:42:00Z", "America/Chicago")).toMatch(/9:42\s?PM/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lc/portal test owner/format`
Expected: FAIL — `isLivePresence`/`formatTimeOnly` not exported; new dot classes mismatch.

- [ ] **Step 3: Implement**

In `apps/portal/lib/owner/format.ts`, replace the `PRESENCE_DOTS` map and add two exports:

```ts
const PRESENCE_DOTS: Record<ProfileStatus, string> = {
  AVAILABLE: "bg-live",
  ON_CALL: "bg-accent",
  AWAY: "bg-muted-foreground",
  OFFLINE: "bg-border",
};

export function presenceDotClass(status: ProfileStatus): string {
  return PRESENCE_DOTS[status];
}

export function isLivePresence(status: ProfileStatus): boolean {
  return status === "AVAILABLE" || status === "ON_CALL";
}

export function formatTimeOnly(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
```

(Keep `presenceLabel`, `formatCallTime`, `formatDuration`, etc. unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lc/portal test owner/format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/format.ts apps/portal/tests/owner/format.test.ts
git commit -m "feat(owner): brand-token presence dots + isLivePresence + formatTimeOnly"
```

---

## Task 3: Day-grouping + last-call summary helpers

**Files:**
- Modify: `apps/portal/lib/owner/summary.ts`
- Test: `apps/portal/tests/owner/summary.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
import { dayGroupLabel, latestCallTime } from "@/lib/owner/summary";

describe("dayGroupLabel", () => {
  const now = new Date("2026-06-07T18:00:00Z"); // 1:00 PM America/Chicago
  it("Today / Yesterday / date", () => {
    expect(dayGroupLabel("2026-06-07T17:00:00Z", "America/Chicago", now)).toBe("Today");
    expect(dayGroupLabel("2026-06-06T17:00:00Z", "America/Chicago", now)).toBe("Yesterday");
    expect(dayGroupLabel("2026-06-01T17:00:00Z", "America/Chicago", now)).toMatch(/Jun 1/);
  });
});

describe("latestCallTime", () => {
  it("returns the max ring_started_at formatted (time only), or null", () => {
    expect(latestCallTime([], "America/Chicago")).toBeNull();
    const out = latestCallTime(
      [{ ring_started_at: "2026-06-07T02:00:00Z" }, { ring_started_at: "2026-06-07T02:42:00Z" }],
      "America/Chicago",
    );
    expect(out).toMatch(/9:42\s?PM/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lc/portal test owner/summary`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement (append to `summary.ts`)**

```ts
import { formatTimeOnly } from "./format";

/** "Today" / "Yesterday" / "Mon D" for an instant in tz, relative to now. */
export function dayGroupLabel(iso: string, timeZone: string, now: Date): string {
  const key = localDateKey(iso, timeZone);
  const todayKey = localDateKey(now.toISOString(), timeZone);
  const yesterdayKey = localDateKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeZone,
  );
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(
    new Date(iso),
  );
}

/** Latest call's time-of-day (tz) from rows, or null when empty. */
export function latestCallTime(
  calls: ReadonlyArray<{ ring_started_at: string }>,
  timeZone: string,
): string | null {
  if (calls.length === 0) return null;
  const latest = calls.reduce((a, b) => (a.ring_started_at > b.ring_started_at ? a : b));
  return formatTimeOnly(latest.ring_started_at, timeZone);
}
```

Note: `localDateKey` already exists in `summary.ts` (private) — reuse it. `dayGroupLabel`'s "Yesterday"
uses a 24h shift, which is correct except across DST transitions where it can be off by an hour at the
boundary; acceptable for a display label.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lc/portal test owner/summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/owner/summary.ts apps/portal/tests/owner/summary.test.ts
git commit -m "feat(owner): dayGroupLabel + latestCallTime helpers"
```

---

## Task 4: Status-pill mapping (pure) + `StatusPill` component

**Files:**
- Create: `apps/portal/lib/owner/status-pill.ts`
- Create: `apps/portal/components/owner/status-pill.tsx`
- Test: `apps/portal/tests/owner/status-pill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/owner/status-pill.test.ts
import { describe, it, expect } from "vitest";
import { callPill, incidentPill } from "@/lib/owner/status-pill";

describe("callPill", () => {
  it("mint family for completed/in-progress", () => {
    expect(callPill("COMPLETED")).toEqual({ label: "Completed", className: "bg-live/15 text-live-foreground" });
    expect(callPill("IN_PROGRESS").className).toBe("bg-live/15 text-live-foreground");
  });
  it("neutral for ringing", () => {
    expect(callPill("RINGING").className).toBe("bg-muted text-muted-foreground");
  });
  it("coral for missed/failed", () => {
    expect(callPill("NO_ANSWER")).toEqual({ label: "Missed", className: "bg-accent/15 text-accent-strong" });
    expect(callPill("FAILED").className).toBe("bg-accent/15 text-accent-strong");
  });
});

describe("incidentPill", () => {
  it("destructive red for open, neutral for resolved", () => {
    expect(incidentPill("OPEN")).toEqual({ label: "Open", className: "bg-destructive/10 text-destructive" });
    expect(incidentPill("RESOLVED")).toEqual({ label: "Resolved", className: "bg-muted text-muted-foreground" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lc/portal test owner/status-pill`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure mapping**

```ts
// apps/portal/lib/owner/status-pill.ts
import type { CallState, IncidentStatus } from "@lc/shared";
import { callStateLabel, incidentStatusLabel } from "./format";

export type Pill = { readonly label: string; readonly className: string };

const CALL_PILL_CLASS: Record<CallState, string> = {
  COMPLETED: "bg-live/15 text-live-foreground",
  IN_PROGRESS: "bg-live/15 text-live-foreground",
  RINGING: "bg-muted text-muted-foreground",
  NO_ANSWER: "bg-accent/15 text-accent-strong",
  FAILED: "bg-accent/15 text-accent-strong",
};

export function callPill(state: CallState): Pill {
  return { label: callStateLabel(state), className: CALL_PILL_CLASS[state] };
}

export function incidentPill(status: IncidentStatus): Pill {
  return {
    label: incidentStatusLabel(status),
    className:
      status === "RESOLVED"
        ? "bg-muted text-muted-foreground"
        : "bg-destructive/10 text-destructive",
  };
}
```

- [ ] **Step 4: Implement the component**

```tsx
// apps/portal/components/owner/status-pill.tsx
import type { CallState, IncidentStatus } from "@lc/shared";
import { callPill, incidentPill } from "@/lib/owner/status-pill";
import { cn } from "@/lib/utils";

type Props =
  | { readonly kind: "call"; readonly status: CallState }
  | { readonly kind: "incident"; readonly status: IncidentStatus };

export function StatusPill(props: Props) {
  const pill = props.kind === "call" ? callPill(props.status) : incidentPill(props.status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 font-label text-[11px] font-semibold uppercase tracking-[0.06em]",
        pill.className,
      )}
    >
      {pill.label}
    </span>
  );
}
```

(`rounded-pill` maps to `--radius-pill: 9999px` from the theme.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lc/portal test owner/status-pill`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/owner/status-pill.ts apps/portal/components/owner/status-pill.tsx apps/portal/tests/owner/status-pill.test.ts
git commit -m "feat(owner): StatusPill component + pure status→class mapping"
```

---

## Task 5: `StatTile` + `SectionCard` presentational components

**Files:**
- Create: `apps/portal/components/owner/stat-tile.tsx`
- Create: `apps/portal/components/owner/section-card.tsx`

(No unit test — pure presentational; covered by typecheck + visual pass.)

- [ ] **Step 1: Implement `StatTile`**

```tsx
// apps/portal/components/owner/stat-tile.tsx
import { cn } from "@/lib/utils";

export function StatTile({
  value,
  label,
  alert = false,
}: {
  readonly value: string | number;
  readonly label: string;
  readonly alert?: boolean;
}) {
  return (
    <div className="flex-1 rounded-input bg-background px-3 py-2">
      <div className={cn("font-mono text-lg font-semibold", alert ? "text-destructive" : "text-foreground")}>
        {value}
      </div>
      <div className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `SectionCard`**

```tsx
// apps/portal/components/owner/section-card.tsx
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function SectionCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/components/owner/stat-tile.tsx apps/portal/components/owner/section-card.tsx
git commit -m "feat(owner): StatTile + SectionCard presentational components"
```

---

## Task 6: `Greeting` client island

**Files:**
- Create: `apps/portal/components/owner/greeting.tsx`

- [ ] **Step 1: Implement (hydration-safe client island)**

```tsx
// apps/portal/components/owner/greeting.tsx
"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@lc/shared";

export function Greeting() {
  // Neutral, stable first paint (matches SSR) → time-aware after mount.
  const [text, setText] = useState("Welcome back");
  useEffect(() => {
    setText(greetingForHour(new Date().getHours()));
  }, []);
  return <h1 className="font-display text-3xl leading-tight text-foreground">{text}</h1>;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS (confirms `@lc/shared` re-exports `greetingForHour`).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/owner/greeting.tsx
git commit -m "feat(owner): time-aware Greeting client island"
```

---

## Task 7: `CallRow` + `IncidentRow` row components

**Files:**
- Create: `apps/portal/components/owner/call-row.tsx`
- Create: `apps/portal/components/owner/incident-row.tsx`

- [ ] **Step 1: Implement `CallRow`**

```tsx
// apps/portal/components/owner/call-row.tsx
import Link from "next/link";
import { Phone, Video } from "lucide-react";
import type { CallState } from "@lc/shared";
import { StatusPill } from "@/components/owner/status-pill";
import { formatTimeOnly, formatDuration } from "@/lib/owner/format";

export type CallRowData = {
  readonly id: string;
  readonly channel: string;
  readonly state: CallState;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly timeZone: string;
  readonly secondary: string; // pre-composed (handler · property · room …)
};

export function CallRow({ call }: { readonly call: CallRowData }) {
  const Icon = call.channel === "VIDEO" ? Video : Phone;
  return (
    <Link
      href={`/owner/calls/${call.id}` as never}
      className="flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-muted text-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">
            {formatTimeOnly(call.ring_started_at, call.timeZone)}
          </span>
          <StatusPill kind="call" status={call.state} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {call.secondary}
          {` · ${formatDuration(call.duration_seconds)}`}
        </span>
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Implement `IncidentRow`**

```tsx
// apps/portal/components/owner/incident-row.tsx
import Link from "next/link";
import { Siren } from "lucide-react";
import type { IncidentStatus } from "@lc/shared";
import { StatusPill } from "@/components/owner/status-pill";
import { formatCallTime } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

export type IncidentRowData = {
  readonly id: string;
  readonly status: IncidentStatus;
  readonly dispatched_to: string;
  readonly created_at: string;
  readonly propertyName: string;
  readonly timeZone: string;
};

export function IncidentRow({ incident }: { readonly incident: IncidentRowData }) {
  const open = incident.status !== "RESOLVED";
  return (
    <Link
      href={`/owner/incidents/${incident.id}` as never}
      className={cn(
        "flex items-center gap-3 rounded-card border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40",
        open && "border-l-2 border-l-destructive",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-destructive/10 text-destructive">
        <Siren className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">911 Emergency</span>
          <StatusPill kind="incident" status={incident.status} />
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {incident.propertyName} · {formatCallTime(incident.created_at, incident.timeZone)} · dispatched to{" "}
          {incident.dispatched_to}
        </span>
      </span>
    </Link>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/components/owner/call-row.tsx apps/portal/components/owner/incident-row.tsx
git commit -m "feat(owner): CallRow + IncidentRow components"
```

---

## Task 8: Shell repaint — seam hairline + coral active nav

**Files:**
- Modify: `apps/portal/app/(owner)/layout.tsx`
- Modify: `apps/portal/components/owner/owner-nav.tsx`

- [ ] **Step 1: Add the seam hairline under the header**

In `app/(owner)/layout.tsx`, replace the `<header>…</header>` element with a wrapping fragment so a seam
hairline sits directly under it (keep everything inside the header unchanged):

```tsx
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/owner">
              <Wordmark />
            </Link>
            <OwnerTopNav />
          </div>
          <UserMenu
            fullName={identity?.full_name ?? ""}
            email={identity?.email ?? ""}
            role="OWNER"
          />
        </div>
        <div className="h-px w-full bg-[image:var(--gradient-seam)]" aria-hidden="true" />
      </header>
```

- [ ] **Step 2: Coral-ize active nav states**

In `components/owner/owner-nav.tsx`, change the two active-class branches:

Top nav (`OwnerTopNav`) active branch — replace
`active === tab ? "bg-primary/10 text-primary" : "text-text-muted hover:text-foreground"` with:

```tsx
            active === tab
              ? "bg-accent/10 text-accent-strong"
              : "text-text-muted hover:text-foreground",
```

Bottom nav (`OwnerBottomNav`) active branch — replace
`active === tab ? "text-primary" : "text-text-muted"` with:

```tsx
            active === tab ? "text-accent-strong" : "text-text-muted",
```

Also bump bottom-nav touch height: change `py-2` to `py-2.5` on the bottom-nav `Link` className.

- [ ] **Step 3: Verify nav test still passes + typecheck**

Run: `pnpm --filter @lc/portal test owner/nav && pnpm --filter @lc/portal typecheck`
Expected: PASS (nav.test.ts covers `activeOwnerTab` logic, untouched here).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/(owner)/layout.tsx apps/portal/components/owner/owner-nav.tsx
git commit -m "feat(owner): shell seam hairline + coral active nav"
```

---

## Task 9: Home repaint (rich cards only)

**Files:**
- Modify: `apps/portal/app/(owner)/owner/page.tsx`
- Modify: `apps/portal/app/(owner)/owner/loading.tsx`

- [ ] **Step 1: Rewrite the Home page body**

Keep all data-fetching (lines ~12–80 in current `page.tsx`) **unchanged**, but extend the `cards` mapping to
include `lastCall` and `live`, and replace the JSX return. Update the imports + `cards` map + return:

Imports (top of file) — add:

```tsx
import { Building2, ChevronRight } from "lucide-react";
import { presenceLabel, presenceDotClass, isLivePresence } from "@/lib/owner/format";
import { countTodayCalls, countOpenIncidents, latestCallTime } from "@/lib/owner/summary";
import { Greeting } from "@/components/owner/greeting";
import { StatTile } from "@/components/owner/stat-tile";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
```

(Remove the now-unused `Badge`, `Siren` imports.)

In the `cards` map, add `lastCall` + `live`:

```tsx
  const cards = props.map((p) => {
    const agent = agentByProperty.get(p.id) ?? null;
    const propCalls = (recentCalls ?? []).filter((c) => c.property_id === p.id);
    const todayCount = countTodayCalls(propCalls, p.timezone, now);
    const openCount = countOpenIncidents(
      (openIncidents ?? []).filter((i) => i.property_id === p.id),
    );
    return {
      id: p.id,
      name: p.name,
      agent,
      todayCount,
      openCount,
      lastCall: latestCallTime(propCalls, p.timezone) ?? "—",
      live: agent ? isLivePresence(agent.status) : false,
    };
  });
```

Replace the `return (…)` with:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <div>
        <Greeting />
        <p className="mt-1 text-sm text-text-muted">Your properties</p>
      </div>

      {cards.length === 0 ? (
        <Card className="items-center gap-2 p-16 text-center">
          <Building2 className="size-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No properties assigned to you yet.</p>
        </Card>
      ) : (
        cards.map((c) => (
          <Link key={c.id} href={`/owner/properties/${c.id}` as never}>
            <Card
              className={cn(
                "gap-3 p-5 transition-colors hover:border-accent/40",
                c.openCount > 0
                  ? "border-l-2 border-l-destructive"
                  : c.live && "border-l-2 border-l-live",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-foreground">{c.name}</span>
                <ChevronRight className="size-5 text-text-muted" aria-hidden="true" />
              </div>
              {c.agent ? (
                <span className="flex items-center gap-2 text-sm text-text-muted">
                  <span className={cn("size-2 rounded-full", presenceDotClass(c.agent.status))} aria-hidden="true" />
                  {c.agent.full_name} · {presenceLabel(c.agent.status)}
                </span>
              ) : (
                <span className="text-sm text-text-muted">No agent assigned</span>
              )}
              <div className="flex gap-2">
                <StatTile value={c.todayCount} label="Calls today" />
                <StatTile value={c.openCount} label="Open" alert={c.openCount > 0} />
                <StatTile value={c.lastCall} label="Last call" />
              </div>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
```

- [ ] **Step 2: Repaint `owner/loading.tsx` to card-shaped skeletons**

Replace the contents of `app/(owner)/owner/loading.tsx` with:

```tsx
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      {[0, 1].map((i) => (
        <Card key={i} className="gap-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-36" />
          <div className="flex gap-2">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 flex-1" />
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS, no unused-import errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/page.tsx" "apps/portal/app/(owner)/owner/loading.tsx"
git commit -m "feat(owner): Home repaint — rich property cards + greeting"
```

---

## Task 10: Calls list repaint (card rows + day grouping)

**Files:**
- Modify: `apps/portal/app/(owner)/owner/calls/page.tsx`
- Modify: `apps/portal/app/(owner)/owner/calls/loading.tsx`

- [ ] **Step 1: Rewrite the render half of `calls/page.tsx`**

Keep all data-fetching (the `properties`, `calls`, handler-name queries, `limit`, `moreHref`) **unchanged**.
Change imports and the JSX. Replace the import block (lines ~1–13) with:

```tsx
import Link from "next/link";
import { Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { CallRow, type CallRowData } from "@/components/owner/call-row";
import { dayGroupLabel } from "@/lib/owner/summary";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AutoRefresh } from "@/components/auto-refresh";
```

After `const rows = calls ?? [];` and the handler-name block, build grouped rows. Add:

```tsx
  const now = new Date();
  // Build display rows + group them by day label (rows already sorted desc).
  const grouped: { label: string; items: CallRowData[] }[] = [];
  for (const c of rows) {
    const tz = tzById.get(c.property_id) ?? "UTC";
    const label = dayGroupLabel(c.ring_started_at, tz, now);
    const secondary = [
      multiProperty ? (nameById.get(c.property_id) ?? "—") : null,
      c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
      c.room_number ? `Room ${c.room_number}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const item: CallRowData = {
      id: c.id,
      channel: c.channel,
      state: c.state,
      ring_started_at: c.ring_started_at,
      duration_seconds: c.duration_seconds,
      timeZone: tz,
      secondary,
    };
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(item);
    else grouped.push({ label, items: [item] });
  }
```

Replace the `return (…)` with:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="font-display text-3xl text-foreground">Calls</h1>

      {multiProperty && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={"/owner/calls" as never}
            className={cn(
              "rounded-pill border px-3 py-1 text-sm",
              !activeProperty ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border text-text-muted",
            )}
          >
            All
          </Link>
          {props.map((p) => (
            <Link
              key={p.id}
              href={`/owner/calls?property=${p.id}` as never}
              className={cn(
                "rounded-pill border px-3 py-1 text-sm",
                activeProperty === p.id
                  ? "border-accent-strong bg-accent/10 text-accent-strong"
                  : "border-border text-text-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="items-center gap-2 p-16 text-center">
          <Phone className="size-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No calls yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <h2 className="font-label text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">
                {g.label}
              </h2>
              {g.items.map((item) => (
                <CallRow key={item.id} call={item} />
              ))}
            </div>
          ))}
        </div>
      )}

      {rows.length === limit && (
        <Button asChild variant="outline" className="self-center">
          <Link href={moreHref as never}>Load more</Link>
        </Button>
      )}
    </div>
  );
```

- [ ] **Step 2: Repaint `calls/loading.tsx`**

Replace its contents with:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-4 w-16" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/calls/page.tsx" "apps/portal/app/(owner)/owner/calls/loading.tsx"
git commit -m "feat(owner): Calls list repaint — card rows + day grouping"
```

---

## Task 11: Call detail repaint (identity header + SectionCards)

**Files:**
- Modify: `apps/portal/app/(owner)/owner/calls/[id]/page.tsx`

- [ ] **Step 1: Rewrite render (keep all queries unchanged)**

Replace the import block + the local `Field` helper + the `return` with the following. Keep the data
fetching (`call`, `property`, `handler`, `incident`) unchanged.

Imports:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { SectionCard } from "@/components/owner/section-card";
import { Card } from "@/components/ui/card";
import { formatCallTime, formatDuration } from "@/lib/owner/format";
```

Local `Field` (restyled, keep above the component):

```tsx
function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
```

Return:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner/calls"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Calls
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="font-display text-3xl text-foreground">
          {call.channel === "VIDEO" ? "Video call" : "Phone call"}
        </h1>
        <StatusPill kind="call" status={call.state} />
      </div>

      {incident && (
        <Link
          href={`/owner/incidents/${incident.id}` as never}
          className="flex items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          <Siren className="size-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <SectionCard title="Call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={property?.name ?? "—"} />
          <Field label="Handled by" value={handler} />
          <Field label="Started" value={formatCallTime(call.ring_started_at, tz)} />
          <Field label="Duration" value={formatDuration(call.duration_seconds)} />
          <Field label="Caller" value={call.caller_number ?? "—"} />
          <Field label="Room" value={call.room_number ?? "—"} />
        </div>
      </SectionCard>

      {call.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{call.notes}</p>
        </SectionCard>
      )}

      {/* Recording seam: dark until call recording ships. No code change needed when recording is enabled. */}
      {call.recording_url && (
        <SectionCard title="Recording">
          <audio controls src={call.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </SectionCard>
      )}
    </div>
  );
```

(`Card` import is unused if you don't reference it — drop it from the import line; lint will flag otherwise.)

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/portal/app/(owner)/owner/calls/[id]/page.tsx"
git commit -m "feat(owner): Call detail repaint — SectionCards + StatusPill"
```

---

## Task 12: Incidents list repaint (card rows)

**Files:**
- Modify: `apps/portal/app/(owner)/owner/incidents/page.tsx`
- Modify: `apps/portal/app/(owner)/owner/incidents/loading.tsx`

- [ ] **Step 1: Rewrite render (keep queries unchanged)**

Replace imports + return; keep the `properties` + `incidents` queries and `rows` unchanged.

Imports:

```tsx
import { Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { IncidentRow } from "@/components/owner/incident-row";
import { Card } from "@/components/ui/card";
import { AutoRefresh } from "@/components/auto-refresh";
```

Return:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AutoRefresh />
      <h1 className="font-display text-3xl text-foreground">Incidents</h1>

      {rows.length === 0 ? (
        <Card className="items-center gap-2 p-16 text-center">
          <Siren className="size-10 text-text-muted/20" aria-hidden="true" />
          <p className="text-sm text-text-muted">No emergencies.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((i) => (
            <IncidentRow
              key={i.id}
              incident={{
                id: i.id,
                status: i.status,
                dispatched_to: i.dispatched_to,
                created_at: i.created_at,
                propertyName: nameById.get(i.property_id) ?? "—",
                timeZone: tzById.get(i.property_id) ?? "UTC",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
```

- [ ] **Step 2: Repaint `incidents/loading.tsx`**

Replace its contents with:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Skeleton className="h-9 w-36" />
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-card" />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/incidents/page.tsx" "apps/portal/app/(owner)/owner/incidents/loading.tsx"
git commit -m "feat(owner): Incidents list repaint — card rows"
```

---

## Task 13: Incident detail repaint (status header + SectionCards) + resolve restyle

**Files:**
- Modify: `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`
- Modify: `apps/portal/app/(owner)/owner/incidents/[id]/resolve-incident.tsx`

- [ ] **Step 1: Rewrite incident detail render (keep queries unchanged)**

Replace imports + `Field` + return. Keep the `incident` + `property` queries.

Imports:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone, Siren } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/owner/status-pill";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime } from "@/lib/owner/format";
import { cn } from "@/lib/utils";
import { ResolveIncident } from "./resolve-incident";
```

`Field` (same restyled helper as Task 11) — include it.

Return:

```tsx
  const open = incident.status !== "RESOLVED";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner/incidents"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Incidents
      </Link>

      <div
        className={cn(
          "flex items-center gap-3 rounded-card border p-4",
          open ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
        )}
      >
        <Siren className={cn("size-5", open ? "text-destructive" : "text-text-muted")} aria-hidden="true" />
        <h1 className="font-display text-2xl text-foreground">911 Emergency</h1>
        <StatusPill kind="incident" status={incident.status} />
      </div>

      <ResolveIncident incidentId={incident.id} status={incident.status} />

      <SectionCard title="Incident">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={property?.name ?? "—"} />
          <Field label="Dispatched to" value={incident.dispatched_to} />
          <Field label="Triggered" value={formatCallTime(incident.created_at, tz)} />
          <Field
            label="Resolved"
            value={incident.resolved_at ? formatCallTime(incident.resolved_at, tz) : "Not resolved"}
          />
        </div>
      </SectionCard>

      {incident.call_id && (
        <Link
          href={`/owner/calls/${incident.call_id}` as never}
          className="flex items-center gap-2 rounded-card border border-border bg-card p-4 text-sm font-medium text-foreground hover:border-accent/40"
        >
          <Phone className="size-4" aria-hidden="true" /> View the originating call
        </Link>
      )}

      {incident.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{incident.notes}</p>
        </SectionCard>
      )}

      {incident.resolution_note && (
        <SectionCard title="Resolution note">
          <p className="whitespace-pre-wrap text-sm text-foreground">{incident.resolution_note}</p>
        </SectionCard>
      )}
    </div>
  );
```

- [ ] **Step 2: Restyle the resolve control**

Open `resolve-incident.tsx`. It returns `null` when not OPEN (keep that). Ensure its action button uses the
branded primitives. Find the primary confirm button and ensure it uses the `Button` component with
`variant="default"` (coral via Stage 1 primitives) and the textarea uses the `Textarea` primitive. If it
already imports `@/components/ui/button` + `@/components/ui/textarea`, only adjust any hardcoded color
classes (e.g. replace any `bg-primary`/`text-primary` with default Button styling; replace a raw `<textarea>`
with `<Textarea>`). Do not change the action wiring, `useTransition`, sonner toast, or the
expand→optional-note→confirm flow.

- [ ] **Step 3: Verify typecheck + lint + existing incident tests**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test owner/incidents`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/incidents/[id]/page.tsx" "apps/portal/app/(owner)/owner/incidents/[id]/resolve-incident.tsx"
git commit -m "feat(owner): Incident detail repaint — status header + SectionCards"
```

---

## Task 14: Property detail repaint (identity header + SectionCards + agent presence)

**Files:**
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/page.tsx`

- [ ] **Step 1: Add an agent-presence query (2-query pattern, same as Home)**

After the `property` fetch + `notFound()` guard and before/after the `recent` calls query, add:

```tsx
  // Assigned agent + presence (2-query pattern).
  const { data: assignment } = await supabase
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", id)
    .is("effective_until", null)
    .maybeSingle();
  let agent: { full_name: string; status: import("@lc/shared").ProfileStatus } | null = null;
  if (assignment?.primary_agent_id) {
    const { data: a } = await supabase
      .from("profiles")
      .select("full_name, status")
      .eq("id", assignment.primary_agent_id)
      .maybeSingle();
    if (a) agent = { full_name: a.full_name, status: a.status };
  }
```

- [ ] **Step 2: Rewrite imports + render**

Imports:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { SectionCard } from "@/components/owner/section-card";
import { CallRow, type CallRowData } from "@/components/owner/call-row";
import { presenceLabel, presenceDotClass } from "@/lib/owner/format";
import { cn } from "@/lib/utils";
import { KioskContentCard } from "./kiosk-content-card";
import { PlaybookCard } from "./playbook-card";
import { KIOSK_FIELDS, type KioskContentInput, type KioskCtaStyle } from "@/lib/owner/kiosk";
```

Keep the `Field` helper (restyled label classes like Task 11). Replace the `return` with:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link
        href="/owner"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" /> Home
      </Link>

      <div>
        <h1 className="font-display text-3xl text-foreground">{property.name}</h1>
        <p className="mt-1 text-sm text-text-muted">{property.timezone}</p>
        {agent ? (
          <span className="mt-2 flex items-center gap-2 text-sm text-text-muted">
            <span className={cn("size-2 rounded-full", presenceDotClass(agent.status))} aria-hidden="true" />
            {agent.full_name} · {presenceLabel(agent.status)}
          </span>
        ) : (
          <span className="mt-2 block text-sm text-text-muted">No agent assigned</span>
        )}
      </div>

      <SectionCard title="Property">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Guest phone" value={property.property_phone_number} />
          <Field label="After-hours support" value={property.after_hours_support_phone} />
          <Field label="Timezone" value={property.timezone} />
        </div>
      </SectionCard>

      <PlaybookCard propertyId={property.id} version={property.playbook_version} />

      <KioskContentCard
        propertyId={property.id}
        initial={kioskInitial}
        initialStyle={(property.kiosk_cta_style ?? "warm") as KioskCtaStyle}
      />

      <SectionCard
        title="Recent calls"
        action={
          <Link href={"/owner/calls" as never} className="text-sm font-medium text-accent-strong hover:underline">
            View all
          </Link>
        }
      >
        {(recent ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No calls yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(recent ?? []).map((c) => {
              const item: CallRowData = {
                id: c.id,
                channel: c.channel,
                state: c.state,
                ring_started_at: c.ring_started_at,
                duration_seconds: null,
                timeZone: property.timezone,
                secondary: c.channel === "VIDEO" ? "Video" : "Audio",
              };
              return <CallRow key={c.id} call={item} />;
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
```

Note: the `recent` query selects `id, channel, state, ring_started_at` (no `duration_seconds`), so
`duration_seconds: null` → `formatDuration` renders "—". Acceptable for the compact recent list. (Optional:
add `duration_seconds` to the `recent` select if you want real durations — additive, safe.)

- [ ] **Step 3: Verify typecheck + lint + kiosk-content/playbook tests**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test owner/kiosk owner/playbook`
Expected: PASS (those tests cover the unchanged card behaviors / route).

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/page.tsx"
git commit -m "feat(owner): Property detail repaint — identity header + SectionCards + presence"
```

---

## Task 15: Restyle kiosk-content + playbook cards into the SectionCard look

**Files:**
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx`
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx`

These are existing client cards. Goal: make their outer chrome match `SectionCard` (Stage 1 `Card`,
uppercase `font-label` header, coral action text) **without touching the edit/save/upload logic, the
`kiosk_cta_style` Appearance picker, audit calls, `useTransition`, sonner toasts, or the synchronous
`window.open` popup fix.**

- [ ] **Step 1: Edit `playbook-card.tsx` (concrete)**

Add the import (with the other `@/components/ui/*` imports near the top):

```tsx
import { Card } from "@/components/ui/card";
```

Replace the wrapper open tag (line ~74):

```tsx
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
```

with:

```tsx
    <Card className="gap-3 p-5">
```

Replace the heading (line ~76):

```tsx
        <h2 className="text-lg font-medium text-foreground">Playbook</h2>
```

with:

```tsx
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">Playbook</h2>
```

Replace the closing `</section>` (line ~96) with `</Card>`. Leave the View/Replace `Button`s, the hidden
file input, `view()`, `onPick()`, `useTransition`, sonner toasts, and the synchronous `window.open` popup
exactly as-is.

- [ ] **Step 2: Edit `kiosk-content-card.tsx` (concrete)**

Add the import:

```tsx
import { Card } from "@/components/ui/card";
```

Replace the wrapper open tag (line ~68):

```tsx
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
```

with:

```tsx
    <Card className="gap-4 p-5">
```

Replace the heading open tag (line ~70) `<h2 className="text-lg font-medium text-foreground">` with:

```tsx
        <h2 className="font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
```

Replace the closing `</section>` (line ~157) with `</Card>`. Then scan the header/action area for any
`text-primary` or `bg-primary` utility on Edit/Save/Cancel affordances and swap `text-primary` →
`text-accent-strong` (Buttons already carry branded variants — leave those). Do **not** touch the
Appearance picker (`kiosk_cta_style` radio cards), the per-field edit/save logic, `useTransition`, audit
calls, or sonner toasts.

- [ ] **Step 3: Verify typecheck + lint + tests**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal test owner/kiosk owner/playbook`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/portal/app/(owner)/owner/properties/[id]/kiosk-content-card.tsx" "apps/portal/app/(owner)/owner/properties/[id]/playbook-card.tsx"
git commit -m "feat(owner): kiosk-content + playbook cards match SectionCard chrome"
```

---

## Task 16: Kiosk Home greeting — time-aware

**Files:**
- Modify: `apps/kiosk/src/screens/Home.tsx`

- [ ] **Step 1: Import the shared helper + replace the hardcoded greeting**

At the top of `apps/kiosk/src/screens/Home.tsx`, add:

```tsx
import { greetingForHour } from "@lc/shared";
```

Replace the hardcoded greeting line (currently `Good evening.`):

```tsx
        <h1 className={`mt-7 font-display text-5xl leading-[1.04] ${s.greet}`}>
          {greetingForHour(new Date().getHours())}.
        </h1>
```

(Browser-local hour = the on-site tablet's local time. The trailing period keeps the kiosk's existing
typographic style.)

- [ ] **Step 2: Verify kiosk typecheck + build + existing kiosk tests**

Run: `pnpm --filter @lc/kiosk typecheck && pnpm --filter @lc/kiosk test`
Expected: PASS (confirms `@lc/shared` resolves in the Vite app).

- [ ] **Step 3: Commit**

```bash
git add apps/kiosk/src/screens/Home.tsx
git commit -m "feat(kiosk): time-aware Home greeting via shared helper"
```

---

## Task 17: Full gate + visual verification + push

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate from repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all green (portal + kiosk + shared). Fix any fallout before proceeding.

- [ ] **Step 2: Visual eyeball (dev server)**

Run: `pnpm --filter @lc/portal dev`, sign in as the seed OWNER (`owner@lobbyconnect.local` / `localdev123`,
Olivia / The Sample Hotel). Check at mobile width (~390px) AND `md+`:
- Home: greeting reads time-appropriate; property card shows agent presence dot (brand color), 3 StatTiles
  (Calls today / Open / Last call), mint left-edge when agent live / red left-edge when an open incident.
- Calls: day-grouped card rows, phone/video icon, StatusPill colors (mint completed / coral missed),
  Load-more button when >50.
- Call detail: identity header + SectionCards; emergency banner when linked.
- Incidents: "911 Emergency" red rows; detail shows red status header when OPEN; Resolve control works.
- Property detail: identity header + presence + Property/Playbook/Kiosk-content/Recent-calls SectionCards;
  inline kiosk edit + Appearance picker + playbook view still work.
- Shell: seam hairline under header; active nav tab is coral; bottom tab bar on mobile.
- Kiosk: `pnpm --filter @lc/kiosk dev` (with a `?t=` token) → Home greeting is time-aware.

- [ ] **Step 3: Push the branch + open PR**

```bash
git push -u origin feat/ui-ux-stage2-owner
gh pr create --title "feat(ui): UI/UX Stage 2 — owner portal repaint" \
  --body "Stage 2 surface 2 (owner portal) premium repaint per docs/specs/2026-06-07-stage2-owner-portal-repaint-design.md. Token/composition layer only — no route/data/RLS/API/migration changes. Also makes the kiosk Home greeting time-aware (shared greetingForHour)."
```

- [ ] **Step 4: Update memory**

Append a session entry to `memory/project-status.md` (Stage 2 surface 2 complete, PR link, test count) and
update the CLAUDE.md build-status row. Commit:

```bash
git add memory/project-status.md CLAUDE.md
git commit -m "docs: Stage 2 owner-portal repaint complete + PR"
git push
```

---

## Self-review notes (coverage check vs spec)

- Spec §3.1 greeting → Task 1. §3.2 StatTile/StatusPill/SectionCard → Tasks 4,5. §3.3 Greeting island →
  Task 6. §3.4 seam/presence/live → Tasks 2,8,9. §4.1 shell → Task 8. §4.2 Home (incl. last-call) →
  Tasks 3,9. §4.3 Calls list → Task 10. §4.4 Call detail → Task 11. §4.5 Incidents list → Task 12.
  §4.6 Incident detail + resolve → Task 13. §4.7 Property detail → Tasks 14,15. §4.8 kiosk greeting →
  Task 16. §7 testing/gates → Task 17.
- Type consistency: `CallRowData`/`IncidentRowData` defined in Task 7, consumed in Tasks 10/14/12;
  `callPill`/`incidentPill` defined Task 4, consumed by `StatusPill`; `latestCallTime`/`dayGroupLabel`
  Task 3, consumed Tasks 9/10; `isLivePresence`/`formatTimeOnly` Task 2, consumed Tasks 9/3/7.
- No migrations / API / RLS touched (verified against spec §1, §6).
```
