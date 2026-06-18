# Owner Portal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the owner portal to the locked brand layout (adaptive single-hotel Home, drill-through metrics, calm inner pages), extract a shared call-list/filter layer, and add a new operator-wide `/admin/calls` page with admin-dashboard deep-links.

**Architecture:** Composition + read-queries + pure helpers only — no migrations, no RLS, no call/voice/emergency logic changes (every field exists). One new pure helper module (`lib/calls/filters.ts`, TDD), two promoted shared components (`components/call/`), one new shared presentational component (`CallFilters`), one new owner component (`PropertyOverview`), one new admin route (`/admin/calls`, user-scoped client). The owner portal adds no routes.

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript, Tailwind v4 (`@theme` brand tokens), shadcn primitives, Vitest, Supabase (user-scoped RLS client), pnpm monorepo.

**Spec:** `docs/specs/2026-06-17-owner-portal-redesign-design.md`
**Branch:** `owner-portal-redesign` (already cut from `main`, spec committed `94ae40d`).

---

## Conventions (read once)

- **Run one test:** `cd apps/portal && pnpm test -- <path>` (e.g. `pnpm test -- tests/lib/calls/filters.test.ts`). `pnpm test` = `vitest run`.
- **Gates:** `cd apps/portal && pnpm typecheck` · `pnpm lint` · `pnpm build`. Repo-wide CI also runs `pnpm check:routes` + `pnpm gen:types:check` (no schema change here, so types won't drift).
- **Tests** live in `apps/portal/tests/<area>/<name>.test.ts`; source under `apps/portal/lib/<area>/`. Import source via `@/lib/...`; shared types via `@lc/shared`.
- **No hardcoded hex** — only Tailwind brand tokens (`bg-live`, `text-accent-text`, `bg-attention`, `text-attention-text`, `text-destructive`, `border-border`, …). **Reuse before adding.**
- **Typed routes** (`typedRoutes: true`): static-literal hrefs (`"/admin/calls"`) need no cast; **query-string / interpolated** hrefs (`` `/owner/calls?outcome=answered` ``) use `as Route` (`import type { Route } from "next"`). **Never `as never`** (banned by `check:routes`).
- **Reused as-is:**
  - `lib/dashboard/calls.ts` — `countByOutcome`, `avgPickupSeconds`, `hourlyVolume`, `countToday`, `splitTodayByChannel`.
  - `lib/owner/format.ts` — `presenceDotClass`, `presenceLabel`, `isLivePresence`, `formatDuration`, `formatTimeOnly`, `formatCallTime`.
  - `lib/owner/summary.ts` — `countOpenIncidents`, `dayGroupLabel`, `isToday`.
  - `lib/owner/calls-cursor.ts` — `encodeCursor`, `decodeCursor`, `keysetOrFilter` (generic; reused by both Calls pages).
  - `lib/voice/presence.ts` — `effectivePresence`, `isStale`.
  - `lib/calls/today-window.ts` — `startOfTodayUtc`.
  - `components/dashboard/{dash-tile,channel-viz}.tsx` — `DashTile` (has `href`), `HourlyVolumeChart`, `ChannelLegend`.
  - `components/dashboard/dashboard-header.tsx` — `DashboardHeader` (`firstName` + optional `children`).
  - `components/owner/{section-card,status-pill,stat-tile}.tsx`, `components/ui/*`, `components/auto-refresh.tsx`, `components/ui/empty-state.tsx`.

## File structure (created / modified)

**New:**
- `lib/calls/filters.ts` — `parseOutcome`, `statesForOutcome`, `buildCallsHref` (pure, TDD).
- `tests/lib/calls/filters.test.ts`.
- `components/call/call-row.tsx`, `components/call/call-detail-body.tsx` — promoted from `components/owner/` (+ injected blaze incident link).
- `components/call/call-filters.tsx` — shared channel/outcome/hotel filter pills.
- `components/owner/property-overview.tsx` — the single-hotel Home glance.
- `app/(admin)/admin/calls/page.tsx`, `app/(admin)/admin/calls/loading.tsx` — operator-wide call history.

**Modified:**
- `app/(owner)/owner/page.tsx` — adaptive Home rewrite (+ `DashboardHeader`).
- `app/(owner)/owner/calls/page.tsx` — outcome filter + shared `CallFilters` + `components/call/` import.
- `app/(owner)/owner/calls/[id]/page.tsx`, `app/(owner)/owner/properties/[id]/page.tsx` — `incidentHref` wiring + calm restyle.
- `lib/owner/status-pill.ts` + `tests/owner/status-pill.test.ts` — incident pill red → blaze.
- `components/owner/incident-row.tsx`, `app/(owner)/owner/incidents/[id]/page.tsx` — blaze + red `911` tag.
- `components/owner/stat-tile.tsx` — optional `href`.
- `app/(admin)/admin/page.tsx` — deep-links into `/admin/calls`.
- `components/app-sidebar.tsx` — admin `Calls` nav item.
- `app/(owner)/layout.tsx` — bottom-nav active brand restyle (light).

**Deleted:** `components/owner/call-row.tsx`, `components/owner/call-detail-body.tsx` (moved to `components/call/`).

---

## Task 1: Call-filter helpers (`lib/calls/filters.ts`)

Pure: map the `?outcome=` param to `calls.state` values, and build filter/pager hrefs. Shared by both Calls pages.

**Files:**
- Create: `apps/portal/lib/calls/filters.ts`
- Test: `apps/portal/tests/lib/calls/filters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/portal/tests/lib/calls/filters.test.ts
import { describe, it, expect } from "vitest";
import { parseOutcome, statesForOutcome, buildCallsHref } from "@/lib/calls/filters";

describe("parseOutcome", () => {
  it("accepts the three known outcomes", () => {
    expect(parseOutcome("answered")).toBe("answered");
    expect(parseOutcome("missed")).toBe("missed");
    expect(parseOutcome("failed")).toBe("failed");
  });
  it("returns null for anything else", () => {
    expect(parseOutcome(undefined)).toBeNull();
    expect(parseOutcome("")).toBeNull();
    expect(parseOutcome("ANSWERED")).toBeNull();
    expect(parseOutcome("live")).toBeNull();
  });
});

describe("statesForOutcome", () => {
  it("maps each outcome to its terminal call state(s)", () => {
    expect(statesForOutcome("answered")).toEqual(["COMPLETED"]);
    expect(statesForOutcome("missed")).toEqual(["NO_ANSWER"]);
    expect(statesForOutcome("failed")).toEqual(["FAILED"]);
  });
});

describe("buildCallsHref", () => {
  it("omits empty params and keeps a clean path", () => {
    expect(buildCallsHref("/owner/calls", {})).toBe("/owner/calls");
  });
  it("serializes the set params in a stable order", () => {
    expect(
      buildCallsHref("/admin/calls", { property: "p1", channel: "VIDEO", outcome: "missed" }),
    ).toBe("/admin/calls?property=p1&channel=VIDEO&outcome=missed");
  });
  it("carries a pagination cursor when present", () => {
    expect(buildCallsHref("/owner/calls", { outcome: "answered", before: "2026-06-17T00:00:00Z~abc" }))
      .toBe("/owner/calls?outcome=answered&before=2026-06-17T00%3A00%3A00Z~abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/portal && pnpm test -- tests/lib/calls/filters.test.ts`
Expected: FAIL — cannot find module `@/lib/calls/filters`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/portal/lib/calls/filters.ts
import type { CallState, CallChannel } from "@lc/shared";

export type Outcome = "answered" | "missed" | "failed";

const OUTCOME_STATES: Record<Outcome, CallState[]> = {
  answered: ["COMPLETED"],
  missed: ["NO_ANSWER"],
  failed: ["FAILED"],
};

/** Narrow a raw query param to a known outcome, else null. */
export function parseOutcome(raw: string | undefined | null): Outcome | null {
  return raw === "answered" || raw === "missed" || raw === "failed" ? raw : null;
}

/** The terminal call state(s) a given outcome filters to. */
export function statesForOutcome(outcome: Outcome): CallState[] {
  return OUTCOME_STATES[outcome];
}

export type CallFilterParams = {
  readonly property?: string | null;
  readonly channel?: CallChannel | null;
  readonly outcome?: Outcome | null;
  readonly before?: string | null;
};

/**
 * Build a Calls href for `basePath` from a full param set. Filter pills pass the
 * desired params with `before` omitted (changing a filter restarts pagination);
 * the pager passes the current filters plus a `before` cursor.
 */
export function buildCallsHref(basePath: string, params: CallFilterParams): string {
  const sp = new URLSearchParams();
  if (params.property) sp.set("property", params.property);
  if (params.channel) sp.set("channel", params.channel);
  if (params.outcome) sp.set("outcome", params.outcome);
  if (params.before) sp.set("before", params.before);
  const qs = sp.toString();
  return `${basePath}${qs ? `?${qs}` : ""}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/portal && pnpm test -- tests/lib/calls/filters.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/calls/filters.ts apps/portal/tests/lib/calls/filters.test.ts
git commit -m "feat(owner): call-filter helpers (parseOutcome, statesForOutcome, buildCallsHref)"
```

---

## Task 2: Promote call-list components to `components/call/` (+ injected blaze incident link)

Move the two role-agnostic call-list components out of `components/owner/` so both portals share them. The one behavioural change: the incident link becomes an **injected href** (owner passes it; admin has no incident route so passes none) and is recoloured **blaze** (was red).

**Files:**
- Create: `apps/portal/components/call/call-detail-body.tsx`
- Create: `apps/portal/components/call/call-row.tsx`
- Delete: `apps/portal/components/owner/call-detail-body.tsx`, `apps/portal/components/owner/call-row.tsx`
- Modify (import re-point + href): `app/(owner)/owner/calls/page.tsx`, `app/(owner)/owner/calls/[id]/page.tsx`, `app/(owner)/owner/properties/[id]/page.tsx`

- [ ] **Step 1: Create `components/call/call-detail-body.tsx`** (drops `incidentId` from the type; renders a blaze incident link only when `incidentHref` is passed)

```tsx
// apps/portal/components/call/call-detail-body.tsx
import Link from "next/link";
import { Siren } from "lucide-react";
import type { Route } from "next";
import type { CallState } from "@lc/shared";
import { SectionCard } from "@/components/owner/section-card";
import { formatCallTime, formatDuration } from "@/lib/owner/format";

export type CallDetail = {
  readonly id: string;
  readonly channel: string; // "AUDIO" | "VIDEO"
  readonly state: CallState;
  readonly caller_number: string | null;
  readonly room_number: string | null;
  readonly ring_started_at: string;
  readonly duration_seconds: number | null;
  readonly notes: string | null;
  readonly recording_url: string | null;
  readonly propertyName: string;
  readonly timeZone: string;
  readonly handlerName: string; // resolved name, or "Unanswered" / "—"
};

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function CallDetailBody({
  data,
  incidentHref,
}: {
  readonly data: CallDetail;
  readonly incidentHref?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {incidentHref && (
        <Link
          href={incidentHref as Route}
          className="flex items-center gap-2 rounded-card border border-attention/40 bg-attention/10 p-4 text-sm font-medium text-attention-text hover:bg-attention/15"
        >
          <Siren className="size-4" aria-hidden="true" /> Emergency — view incident
        </Link>
      )}

      <SectionCard title="Call">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Property" value={data.propertyName} />
          <Field label="Handled by" value={data.handlerName} />
          <Field label="Started" value={formatCallTime(data.ring_started_at, data.timeZone)} />
          <Field label="Duration" value={formatDuration(data.duration_seconds)} />
          <Field label="Caller" value={data.caller_number ?? "—"} />
          <Field label="Room" value={data.room_number ?? "—"} />
        </div>
      </SectionCard>

      {data.notes && (
        <SectionCard title="Notes">
          <p className="whitespace-pre-wrap text-sm text-foreground">{data.notes}</p>
        </SectionCard>
      )}

      {/* Recording seam: dark until call recording ships. Do not add an iframe sandbox. */}
      {data.recording_url && (
        <SectionCard title="Recording">
          <audio controls src={data.recording_url} className="w-full">
            <track kind="captions" />
          </audio>
        </SectionCard>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/call/call-row.tsx`** (carries an optional `incidentHref` through to the body)

```tsx
// apps/portal/components/call/call-row.tsx
"use client";

import { useId, useState } from "react";
import { Phone, Video, StickyNote, ChevronDown } from "lucide-react";
import { StatusPill } from "@/components/owner/status-pill";
import { formatTimeOnly, formatDuration } from "@/lib/owner/format";
import { CallDetailBody, type CallDetail } from "@/components/call/call-detail-body";
import { cn } from "@/lib/utils";

export type CallRowData = {
  readonly secondary: string; // pre-composed (handler · property · room …)
  readonly detail: CallDetail;
  readonly incidentHref?: string | null; // owner: link; admin: omitted
};

export function CallRow({ call }: { readonly call: CallRowData }) {
  const { detail, secondary } = call;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const Icon = detail.channel === "VIDEO" ? Video : Phone;
  const hasNotes = Boolean(detail.notes?.trim());

  return (
    <div className="rounded-card border border-border bg-card shadow-sm transition-colors hover:border-accent/40">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-input bg-muted text-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {hasNotes && (
          <StickyNote className="size-3.5 shrink-0 text-text-muted" role="img" aria-label="Has notes" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {formatTimeOnly(detail.ring_started_at, detail.timeZone)}
            </span>
            <StatusPill kind="call" status={detail.state} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {secondary}
            {` · ${formatDuration(detail.duration_seconds)}`}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border p-4">
          <CallDetailBody data={detail} incidentHref={call.incidentHref} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Delete the old files**

```bash
git rm apps/portal/components/owner/call-row.tsx apps/portal/components/owner/call-detail-body.tsx
```

- [ ] **Step 4: Re-point the three owner callers.** In each, change the import path and the incident wiring:
  - `app/(owner)/owner/calls/page.tsx`: import `CallRow, type CallRowData` from `@/components/call/call-row`. In the row builder, **remove** `incidentId` from `detail` and instead set `incidentHref` on the `CallRowData`:

```tsx
const incId = incidentByCall.get(c.id) ?? null;
const item: CallRowData = {
  secondary,
  incidentHref: incId ? `/owner/incidents/${incId}` : null,
  detail: {
    id: c.id, channel: c.channel, state: c.state,
    caller_number: c.caller_number, room_number: c.room_number,
    ring_started_at: c.ring_started_at, duration_seconds: c.duration_seconds,
    notes: c.notes, recording_url: c.recording_url,
    propertyName: nameById.get(c.property_id) ?? "—", timeZone: tz,
    handlerName: c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
  },
};
```

  - `app/(owner)/owner/calls/[id]/page.tsx`: import `CallDetailBody, type CallDetail` from `@/components/call/call-detail-body`; build the `CallDetail` **without** `incidentId`, and pass the link separately: `<CallDetailBody data={detail} incidentHref={incidentId ? \`/owner/incidents/${incidentId}\` : null} />`.
  - `app/(owner)/owner/properties/[id]/page.tsx`: import `CallRow`/`CallRowData` from `@/components/call/call-row`; if its recent-call rows resolved an incident id, set `incidentHref` the same way (else omit). (Property detail's recent calls may not resolve incidents — if so, leave `incidentHref` unset; the link simply won't render.)

- [ ] **Step 5: Verify gates + full suite**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. If any test imports `@/components/owner/call-row` or `call-detail-body`, re-point it to `@/components/call/...`. (Search: `grep -rn "owner/call-row\|owner/call-detail-body" apps/portal`.)

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/call apps/portal/components/owner apps/portal/app/\(owner\)
git commit -m "refactor(call): promote CallRow/CallDetailBody to components/call; inject blaze incident link"
```

---

## Task 3: Shared filter pills (`components/call/call-filters.tsx`)

A presentational pill bar — hotel (only when >1 property), channel, outcome — built from `buildCallsHref`. Reused by both Calls pages.

**Files:**
- Create: `apps/portal/components/call/call-filters.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/portal/components/call/call-filters.tsx
import Link from "next/link";
import type { Route } from "next";
import type { CallChannel } from "@lc/shared";
import { buildCallsHref, type Outcome } from "@/lib/calls/filters";
import { cn } from "@/lib/utils";

type PillProps = { readonly href: string; readonly label: string; readonly active: boolean; readonly dot?: string };

function Pill({ href, label, active, dot }: PillProps) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-sm transition-colors",
        active ? "border-accent bg-accent/10 text-accent-text" : "border-border text-text-muted hover:text-foreground",
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" /> : null}
      {label}
    </Link>
  );
}

const LABEL = "font-label text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted";

export function CallFilters({
  basePath,
  properties,
  activeProperty,
  activeChannel,
  activeOutcome,
}: {
  readonly basePath: string;
  readonly properties: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly activeProperty: string | null;
  readonly activeChannel: CallChannel | null;
  readonly activeOutcome: Outcome | null;
}) {
  // Each pill keeps the other active filters and drops the cursor (new filter → newest page).
  const href = (over: { property?: string | null; channel?: CallChannel | null; outcome?: Outcome | null }) =>
    buildCallsHref(basePath, {
      property: "property" in over ? over.property : activeProperty,
      channel: "channel" in over ? over.channel : activeChannel,
      outcome: "outcome" in over ? over.outcome : activeOutcome,
    });

  return (
    <div className="flex flex-col gap-2">
      {properties.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>Hotel</span>
          <Pill href={href({ property: null })} label="All" active={!activeProperty} />
          {properties.map((p) => (
            <Pill key={p.id} href={href({ property: p.id })} label={p.name} active={activeProperty === p.id} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Channel</span>
        <Pill href={href({ channel: null })} label="All" active={!activeChannel} />
        <Pill href={href({ channel: "AUDIO" })} label="Phone" active={activeChannel === "AUDIO"} />
        <Pill href={href({ channel: "VIDEO" })} label="Video" active={activeChannel === "VIDEO"} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>Outcome</span>
        <Pill href={href({ outcome: null })} label="All" active={!activeOutcome} />
        <Pill href={href({ outcome: "answered" })} label="Answered" active={activeOutcome === "answered"} dot="bg-live" />
        <Pill href={href({ outcome: "missed" })} label="Missed" active={activeOutcome === "missed"} dot="bg-attention" />
        <Pill href={href({ outcome: "failed" })} label="Failed" active={activeOutcome === "failed"} dot="bg-muted-foreground" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/portal && pnpm typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/call/call-filters.tsx
git commit -m "feat(call): shared CallFilters pill bar (hotel/channel/outcome)"
```

---

## Task 4: Owner Calls — outcome filter + shared filters

Wire `?outcome=` into the query and swap the inline pills for `<CallFilters>`. Keep keyset pagination + day grouping.

**Files:**
- Modify: `apps/portal/app/(owner)/owner/calls/page.tsx`

- [ ] **Step 1: Parse the outcome param + apply it.** Update the `searchParams` type and parsing:

```tsx
import { parseOutcome, statesForOutcome, buildCallsHref } from "@/lib/calls/filters";
import { CallFilters } from "@/components/call/call-filters";
// searchParams type:
searchParams: Promise<{ property?: string; before?: string; channel?: string; outcome?: string }>;
// after destructuring `outcome: outcomeParam`:
const activeOutcome = parseOutcome(outcomeParam);
```

  After the existing `activeChannel` filter block, add:

```tsx
if (activeOutcome) {
  callsQuery = callsQuery.in("state", statesForOutcome(activeOutcome));
}
```

- [ ] **Step 2: Replace `buildHref` + the inline pill rows.** Delete the local `buildHref` and the two inline `<div className="flex flex-wrap gap-2">` pill blocks (property + channel). Replace the pager hrefs to use the shared builder, and render `<CallFilters>`:

```tsx
const olderHref = lastRow
  ? buildCallsHref("/owner/calls", {
      property: activeProperty, channel: activeChannel, outcome: activeOutcome,
      before: encodeCursor({ created_at: lastRow.created_at, id: lastRow.id }),
    })
  : null;
const newestHref = buildCallsHref("/owner/calls", {
  property: activeProperty, channel: activeChannel, outcome: activeOutcome,
});
```

  And in the JSX, under the `<h1>Calls</h1>`:

```tsx
<CallFilters
  basePath="/owner/calls"
  properties={props}
  activeProperty={activeProperty}
  activeChannel={activeChannel}
  activeOutcome={activeOutcome}
/>
```

- [ ] **Step 3: Verify gates**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. Manually reason: `/owner/calls?outcome=missed` adds `.in("state", ["NO_ANSWER"])`; combines with `?channel=VIDEO` and `?property=`.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/\(owner\)/owner/calls/page.tsx
git commit -m "feat(owner): Calls outcome filter (answered/missed/failed) + shared CallFilters"
```

---

## Task 5: Owner Home — adaptive (single-hotel overview / multi-hotel cards)

The centerpiece. Branch on property count. Render the gradient `DashboardHeader` (Home only). Build the `PropertyOverview` glance for one hotel; keep rich cards for many.

**Files:**
- Create: `apps/portal/components/owner/property-overview.tsx`
- Modify: `apps/portal/app/(owner)/owner/page.tsx`

- [ ] **Step 1: Create `PropertyOverview`** — the single-hotel glance (coverage strip + drill-through DashTiles + volume chart with quiet-night state + recent + incidents + manage).

```tsx
// apps/portal/components/owner/property-overview.tsx
import Link from "next/link";
import { Phone, ChevronRight } from "lucide-react";
import type { Route } from "next";
import type { ProfileStatus } from "@lc/shared";
import { Card } from "@/components/ui/card";
import { DashTile } from "@/components/dashboard/dash-tile";
import { HourlyVolumeChart, ChannelLegend } from "@/components/dashboard/channel-viz";
import { CallRow, type CallRowData } from "@/components/call/call-row";
import { hourlyVolume, countByOutcome, avgPickupSeconds, type DatedCall } from "@/lib/dashboard/calls";
import { presenceDotClass, presenceLabel, isLivePresence, formatTimeOnly, formatDuration } from "@/lib/owner/format";
import { cn } from "@/lib/utils";

const LABEL = "font-label text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted";

export type OverviewCall = DatedCall & {
  readonly state: import("@lc/shared").CallState;
  readonly channel: import("@lc/shared").CallChannel;
  readonly answered_at: string | null;
};

export function PropertyOverview({
  propertyId,
  propertyName,
  agent,
  todayCalls,
  recent,
  openIncidents,
  now,
}: {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly agent: { readonly full_name: string; readonly status: ProfileStatus } | null;
  readonly todayCalls: ReadonlyArray<OverviewCall>;
  readonly recent: ReadonlyArray<CallRowData>;
  readonly openIncidents: number;
  readonly now: Date;
}) {
  const outcomes = countByOutcome(todayCalls, now);
  const pickup = avgPickupSeconds(todayCalls, now);
  const hourly = hourlyVolume(todayCalls, now);
  const lastCall = todayCalls[0] ? formatTimeOnly(todayCalls[0].ring_started_at, todayCalls[0].timeZone) : "—";
  const live = agent ? isLivePresence(agent.status) : false;
  const callsHref = (outcome: "answered" | "missed") => `/owner/calls?outcome=${outcome}` as Route;

  return (
    <div className="flex flex-col gap-4">
      {/* Coverage strip */}
      <Card className={cn("flex-row items-center justify-between gap-3 p-4", openIncidents > 0 ? "border-l-2 border-l-attention" : live && "border-l-2 border-l-live")}>
        <span className="font-display text-lg font-medium text-foreground">{propertyName}</span>
        {agent ? (
          <span className="inline-flex items-center gap-2 text-sm text-text-muted">
            <span className={cn("size-2 rounded-full", presenceDotClass(agent.status))} aria-hidden="true" />
            {agent.full_name} · {presenceLabel(agent.status)}
          </span>
        ) : (
          <span className="text-sm text-text-muted">No agent assigned</span>
        )}
      </Card>

      {/* Drill-through stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DashTile value={outcomes.answered} label="Answered" tone="live" href={callsHref("answered")} />
        <DashTile value={outcomes.missed} label="Missed" tone={outcomes.missed > 0 ? "attention" : "default"} href={callsHref("missed")} />
        <DashTile value={formatDuration(pickup)} label="Avg pickup" />
        <DashTile value={lastCall} label="Last call" />
      </div>

      {/* Tonight · call volume (graceful quiet-night state) */}
      <Card className="gap-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={LABEL}>Tonight · call volume</h2>
          <ChannelLegend />
        </div>
        {todayCalls.length > 0 ? (
          <HourlyVolumeChart data={hourly} className="mt-1" />
        ) : (
          <p className="py-6 text-center text-sm text-text-muted">Quiet so far tonight.</p>
        )}
      </Card>

      {/* Recent + Incidents + Manage */}
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
        <Card className="gap-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className={LABEL}>Recent calls</h2>
            <Link href="/owner/calls" className="text-sm text-accent-text hover:underline">View all</Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">No calls yet.</p>
          ) : (
            <div className="flex flex-col gap-2">{recent.map((c) => <CallRow key={c.detail.id} call={c} />)}</div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="gap-2 p-5">
            <h2 className={LABEL}>Incidents</h2>
            {openIncidents > 0 ? (
              <Link href="/owner/incidents" className="inline-flex items-center gap-2 text-sm font-medium text-attention-text hover:underline">
                {openIncidents} open incident{openIncidents === 1 ? "" : "s"} <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <p className="inline-flex items-center gap-2 text-sm text-live-foreground">All clear tonight</p>
            )}
          </Card>
          <Card className="gap-1 p-5">
            <h2 className={LABEL}>Manage</h2>
            <Link href={`/owner/properties/${propertyId}` as Route} className="flex items-center justify-between py-2 text-sm text-accent-text hover:underline">
              Property, kiosk &amp; playbook <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

> `HourlyVolumeChart`/`ChannelLegend` props: confirm against `components/dashboard/channel-viz.tsx` (admin passes `data={hourly}` from `hourlyVolume(calls, now)` and renders `<ChannelLegend />`). Match that call shape exactly.

- [ ] **Step 2: Rewrite `app/(owner)/owner/page.tsx`** — `DashboardHeader` greeting, then branch.

```tsx
// apps/portal/app/(owner)/owner/page.tsx
import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import type { Route } from "next";
import type { ProfileStatus, IncidentStatus, CallState, CallChannel } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { presenceLabel, presenceDotClass, isLivePresence, formatTimeOnly } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { countOpenIncidents } from "@/lib/owner/summary";
import { startOfTodayUtc } from "@/lib/calls/today-window";
import { AutoRefresh } from "@/components/auto-refresh";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatTile } from "@/components/owner/stat-tile";
import { PropertyOverview, type OverviewCall } from "@/components/owner/property-overview";
import { CallRow, type CallRowData } from "@/components/call/call-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";

type SupabaseServer = Awaited<ReturnType<typeof createServerClient>>;

async function resolveAgent(
  supabase: SupabaseServer, propertyId: string, now: Date,
): Promise<{ full_name: string; status: ProfileStatus } | null> {
  const { data: assignment } = await supabase
    .from("property_assignments").select("primary_agent_id")
    .eq("property_id", propertyId).is("effective_until", null).maybeSingle();
  if (!assignment) return null;
  const { data: a } = await supabase
    .from("profiles").select("full_name, status, last_seen_at")
    .eq("id", assignment.primary_agent_id).maybeSingle();
  if (!a) return null;
  return { full_name: a.full_name, status: effectivePresence(a.status, a.last_seen_at, now.getTime()) };
}

export default async function OwnerHomePage() {
  const actor = await requireRole("OWNER");
  const supabase = await createServerClient();
  const now = new Date();
  const firstName = actor.full_name.split(/\s+/)[0] ?? actor.full_name;

  const { data: properties } = await supabase
    .from("properties").select("id, name, timezone")
    .eq("operator_id", actor.operator_id).eq("owner_user_id", actor.id).eq("active", true).order("name");
  const props = properties ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <AutoRefresh />
      <h1 className="sr-only">Your hotel</h1>
      <DashboardHeader firstName={firstName} />
      {props.length === 1 ? (
        <SingleHotel supabase={supabase} property={props[0]!} now={now} />
      ) : (
        <MultiHotel supabase={supabase} props={props} now={now} />
      )}
    </div>
  );
}
```

  Then add the two server helpers in the same file:

```tsx
async function SingleHotel({
  supabase, property, now,
}: { supabase: SupabaseServer; property: { id: string; name: string; timezone: string }; now: Date }) {
  const since = startOfTodayUtc(property.timezone, now);
  const [{ data: agentRaw }, { data: callsRaw }, { data: openRows }] = await Promise.all([
    Promise.resolve({ data: await resolveAgent(supabase, property.id, now) }),
    supabase.from("calls")
      .select("id, channel, state, ring_started_at, answered_at, duration_seconds, room_number, caller_number, notes, recording_url, handled_by_user_id")
      .eq("property_id", property.id).gte("ring_started_at", since).order("ring_started_at", { ascending: false }),
    supabase.from("incidents").select("status").eq("property_id", property.id).neq("status", "RESOLVED"),
  ]);
  const agent = agentRaw;
  const rows = callsRaw ?? [];

  const handlerIds = [...new Set(rows.map((c) => c.handled_by_user_id).filter((x): x is string => !!x))];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  const todayCalls: OverviewCall[] = rows.map((c) => ({
    ring_started_at: c.ring_started_at, timeZone: property.timezone,
    state: c.state as CallState, channel: c.channel as CallChannel, answered_at: c.answered_at,
  }));
  const recent: CallRowData[] = rows.slice(0, 5).map((c) => ({
    secondary: [c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered", c.room_number ? `Room ${c.room_number}` : null].filter(Boolean).join(" · "),
    detail: {
      id: c.id, channel: c.channel, state: c.state, caller_number: c.caller_number, room_number: c.room_number,
      ring_started_at: c.ring_started_at, duration_seconds: c.duration_seconds, notes: c.notes, recording_url: c.recording_url,
      propertyName: property.name, timeZone: property.timezone,
      handlerName: c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
    },
  }));

  return (
    <PropertyOverview
      propertyId={property.id} propertyName={property.name} agent={agent}
      todayCalls={todayCalls} recent={recent} openIncidents={countOpenIncidents(openRows ?? [])} now={now}
    />
  );
}
```

  And `MultiHotel` — keep the **existing** count-query card logic from the current page (per-property today count via `{ count, head:true }`, last-call, open-incident count, agent presence dot), restyled as rich cards. (Lift the current `page.tsx` Promise.all card builder verbatim into this helper; it already works. Each card links to `/owner/properties/[id]`.)

- [ ] **Step 3: Verify gates**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. (Supabase nested types may need the `as CallState` / `as CallChannel` casts shown.)

- [ ] **Step 4: Commit**

```bash
git add apps/portal/components/owner/property-overview.tsx apps/portal/app/\(owner\)/owner/page.tsx
git commit -m "feat(owner): adaptive Home — single-hotel overview + DashboardHeader greeting"
```

---

## Task 6: Owner chrome — bottom-nav brand restyle + seam continuity

Small. The layout already has the wordmark bar + seam hairline + nav; restyle the active states to brand tokens (teal-wash) and confirm the seam threads inner pages.

**Files:**
- Modify: `apps/portal/components/owner/owner-nav.tsx`

- [ ] **Step 1:** In `OwnerBottomNav`, the active class is already `text-accent-text`; add a subtle active wash for the tab and ensure the inactive uses `text-text-muted`. (Top nav already uses `bg-accent/10 text-accent-text` active — leave it.) Bottom-nav active tab:

```tsx
className={cn(
  "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
  active === tab ? "text-accent-text" : "text-text-muted hover:text-foreground",
)}
```

  (Keep structure; this is a token confirm, not a rewrite. The layout's seam hairline + bottom nav already render on every page — no change needed there.)

- [ ] **Step 2: Verify + commit**

Run: `cd apps/portal && pnpm typecheck && pnpm lint`

```bash
git add apps/portal/components/owner/owner-nav.tsx
git commit -m "style(owner): bottom-nav brand active state"
```

---

## Task 7: Incidents → blaze (+ factual red 911 tag)

Move the incident *status* attention signal from red → blaze across the pill, the list row, and the detail header; keep a factual **red `911`** tag on the emergency identity.

**Files:**
- Modify: `apps/portal/lib/owner/status-pill.ts`
- Modify: `apps/portal/tests/owner/status-pill.test.ts`
- Modify: `apps/portal/components/owner/incident-row.tsx`
- Modify: `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx`

- [ ] **Step 1: Update the test first** (red → blaze):

```tsx
// tests/owner/status-pill.test.ts — replace the incidentPill case:
describe("incidentPill", () => {
  it("blaze (attention) for open, neutral for resolved", () => {
    expect(incidentPill("OPEN")).toEqual({ label: "Open", className: "bg-attention/15 text-attention-text" });
    expect(incidentPill("RESOLVED")).toEqual({ label: "Resolved", className: "bg-muted text-muted-foreground" });
  });
});
```

- [ ] **Step 2: Run it red**

Run: `cd apps/portal && pnpm test -- tests/owner/status-pill.test.ts`
Expected: FAIL (current code returns `bg-destructive/10 text-destructive`).

- [ ] **Step 3: Update `incidentPill`** in `lib/owner/status-pill.ts`:

```tsx
export function incidentPill(status: IncidentStatus): Pill {
  return {
    label: incidentStatusLabel(status),
    className:
      status === "RESOLVED"
        ? "bg-muted text-muted-foreground"
        : "bg-attention/15 text-attention-text",
  };
}
```

  Run the test again → PASS.

- [ ] **Step 4: `incident-row.tsx`** — edge + icon → blaze; title gains a red `911` tag. Change the open edge `border-l-destructive` → `border-l-attention`; icon `bg-destructive/10 text-destructive` → `bg-attention/15 text-attention-text`; and the title block:

```tsx
<span className="flex items-center gap-2">
  <span className="font-medium text-foreground">Emergency call</span>
  <span className="rounded-[5px] bg-destructive/10 px-1.5 py-px font-label text-[10px] font-bold tracking-[0.04em] text-destructive">911</span>
</span>
```

- [ ] **Step 5: incident detail page** — header open tint → blaze; Siren → blaze; add the red `911` tag next to the heading:

```tsx
<div className={cn("flex items-center gap-3 rounded-card border p-4",
  open ? "border-attention/40 bg-attention/10" : "border-border bg-card")}>
  <Siren className={cn("size-5", open ? "text-attention-text" : "text-text-muted")} aria-hidden="true" />
  <h1 className="font-display text-2xl text-foreground">Emergency</h1>
  <span className="rounded-[5px] bg-destructive/10 px-1.5 py-0.5 font-label text-[11px] font-bold tracking-[0.04em] text-destructive">911</span>
  <StatusPill kind="incident" status={incident.status} />
</div>
```

- [ ] **Step 6: Verify gates + suite**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/owner/status-pill.ts apps/portal/tests/owner/status-pill.test.ts apps/portal/components/owner/incident-row.tsx apps/portal/app/\(owner\)/owner/incidents/\[id\]/page.tsx
git commit -m "feat(owner): incidents → blaze attention + factual red 911 tag"
```

---

## Task 8: Owner verification checkpoint

- [ ] **Step 1: Full gate**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint && pnpm build` — ALL PASS. Repo root `pnpm test` for the shared package.

- [ ] **Step 2: Browser pass — on a Vercel preview, not local dev** (the dev server is unreliable under the harness sandbox; never `xargs kill -9` by port). Push the branch, open the preview as the seed OWNER (`owner@lobbyconnect.local` / `localdev123`, owns "The Sample Hotel"). Check: Home single-hotel overview (coverage, tiles, chart or quiet-night, recent, incidents, manage); tap **Answered** → `/owner/calls?outcome=answered`; tap **Missed** → missed; the Calls outcome+channel filters compose; incidents render blaze with the red `911` tag; mobile + desktop chrome (gradient header on Home only, calm inner pages). 

- [ ] **Step 3: Commit any fixes.**

---

## Task 9: `StatTile` optional `href` (admin outcome drill-in)

The admin "Tonight" outcomes strip uses `StatTile` (sub-tiles inside a white card). Add an optional `href` so Answered/Missed there can drill into `/admin/calls` — backward-compatible (existing usages unaffected).

**Files:**
- Modify: `apps/portal/components/owner/stat-tile.tsx`

- [ ] **Step 1: Add `href`**

```tsx
// apps/portal/components/owner/stat-tile.tsx
import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  value, label, alert = false, href,
}: {
  readonly value: string | number;
  readonly label: string;
  readonly alert?: boolean;
  readonly href?: Route;
}) {
  const body = (
    <>
      <div className={cn("font-mono text-lg font-semibold", alert ? "text-attention-text" : "text-foreground")}>{value}</div>
      <div className="font-label text-[10px] uppercase tracking-[0.06em] text-text-muted">{label}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="group flex-1 rounded-input bg-background px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">{body}</div>
          <ChevronRight className="size-3.5 shrink-0 text-text-muted transition-colors group-hover:text-accent-text" aria-hidden="true" />
        </div>
      </Link>
    );
  }
  return <div className="flex-1 rounded-input bg-background px-3 py-2">{body}</div>;
}
```

- [ ] **Step 2: Verify gates + suite** (existing `StatTile` usages still typecheck — `href` is optional)

Run: `cd apps/portal && pnpm typecheck && pnpm lint && pnpm test`

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/owner/stat-tile.tsx
git commit -m "feat(dashboard): optional href drill-in on StatTile"
```

---

## Task 10: New `/admin/calls` page (operator-wide) + sidebar nav

Operator-wide call history in the admin shell. Reuses `CallFilters`, `CallRow`, the keyset cursor, and the 2-query handler merge. Admins have no incident route → no `incidentHref`.

**Files:**
- Create: `apps/portal/app/(admin)/admin/calls/page.tsx`
- Create: `apps/portal/app/(admin)/admin/calls/loading.tsx`
- Modify: `apps/portal/components/app-sidebar.tsx`

- [ ] **Step 1: Add the sidebar nav item.** In `app-sidebar.tsx`, import `Phone` from `lucide-react` and insert into `ADMIN_NAV` after Overview:

```tsx
{ href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
{ href: "/admin/calls", label: "Calls", icon: Phone },
{ href: "/admin/users", label: "Users", icon: Users },
```

- [ ] **Step 2: Implement the page** (mirror the owner Calls page, operator-wide; no owner filter, hotel filter shows all operator properties):

```tsx
// apps/portal/app/(admin)/admin/calls/page.tsx
import { Phone } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { CallRow, type CallRowData } from "@/components/call/call-row";
import { CallFilters } from "@/components/call/call-filters";
import { dayGroupLabel } from "@/lib/owner/summary";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import type { CallChannel } from "@lc/shared";
import { parseOutcome, statesForOutcome, buildCallsHref } from "@/lib/calls/filters";
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";
import type { Route } from "next";
import Link from "next/link";

const PAGE_SIZE = 50;

export default async function AdminCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; before?: string; channel?: string; outcome?: string }>;
}) {
  const { property, before, channel: channelParam, outcome: outcomeParam } = await searchParams;
  const cursor = decodeCursor(before);
  const activeChannel: CallChannel | null = channelParam === "AUDIO" || channelParam === "VIDEO" ? channelParam : null;
  const activeOutcome = parseOutcome(outcomeParam);
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  const { data: properties } = await supabase
    .from("properties").select("id, name, timezone")
    .eq("operator_id", actor.operator_id).order("name");
  const props = properties ?? [];
  const tzById = new Map(props.map((p) => [p.id, p.timezone]));
  const nameById = new Map(props.map((p) => [p.id, p.name]));
  const activeProperty = property && tzById.has(property) ? property : null;

  let q = supabase
    .from("calls")
    .select("id, created_at, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number, caller_number, notes, recording_url")
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
  if (cursor) q = q.or(keysetOrFilter(cursor));
  if (activeProperty) q = q.eq("property_id", activeProperty);
  if (activeChannel) q = q.eq("channel", activeChannel);
  if (activeOutcome) q = q.in("state", statesForOutcome(activeOutcome));

  const { data: calls } = await q;
  const rows = calls ?? [];

  const handlerIds = [...new Set(rows.map((c) => c.handled_by_user_id).filter((x): x is string => !!x))];
  const handlerName = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: handlers } = await supabase.from("profiles").select("id, full_name").in("id", handlerIds);
    for (const h of handlers ?? []) handlerName.set(h.id, h.full_name);
  }

  const now = new Date();
  const grouped: { label: string; items: CallRowData[] }[] = [];
  for (const c of rows) {
    const tz = tzById.get(c.property_id) ?? "UTC";
    const label = dayGroupLabel(c.ring_started_at, tz, now);
    const item: CallRowData = {
      // operator-wide secondary line: hotel · handler · room
      secondary: [
        nameById.get(c.property_id) ?? "—",
        c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
        c.room_number ? `Room ${c.room_number}` : null,
      ].filter(Boolean).join(" · "),
      detail: {
        id: c.id, channel: c.channel, state: c.state, caller_number: c.caller_number, room_number: c.room_number,
        ring_started_at: c.ring_started_at, duration_seconds: c.duration_seconds, notes: c.notes, recording_url: c.recording_url,
        propertyName: nameById.get(c.property_id) ?? "—", timeZone: tz,
        handlerName: c.handled_by_user_id ? (handlerName.get(c.handled_by_user_id) ?? "—") : "Unanswered",
      },
      // no incidentHref — admins have no incident route
    };
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(item);
    else grouped.push({ label, items: [item] });
  }

  const lastRow = rows[rows.length - 1];
  const olderHref = lastRow ? buildCallsHref("/admin/calls", { property: activeProperty, channel: activeChannel, outcome: activeOutcome, before: encodeCursor({ created_at: lastRow.created_at, id: lastRow.id }) }) : null;
  const newestHref = buildCallsHref("/admin/calls", { property: activeProperty, channel: activeChannel, outcome: activeOutcome });

  return (
    <div className="flex w-full flex-col gap-4">
      <h1 className="font-display text-3xl text-foreground">Calls</h1>
      <CallFilters basePath="/admin/calls" properties={props} activeProperty={activeProperty} activeChannel={activeChannel} activeOutcome={activeOutcome} />

      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState icon={Phone} title="No calls match" description="Try a different filter, or check back as the shift runs." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <div key={g.label} className="flex flex-col gap-2">
              <h2 className="font-label text-[10px] font-semibold uppercase tracking-[0.07em] text-text-muted">{g.label}</h2>
              {g.items.map((item) => <CallRow key={item.detail.id} call={item} />)}
            </div>
          ))}
        </div>
      )}

      <nav aria-label="Call history pages" className="flex items-center justify-between">
        {cursor ? <Button asChild variant="ghost" size="sm"><Link href={newestHref as Route} aria-label="Go to newest calls">← Newest</Link></Button> : <span />}
        {rows.length === PAGE_SIZE && olderHref ? <Button asChild variant="outline" size="sm"><Link href={olderHref as Route} aria-label="Go to older calls">Older →</Link></Button> : <span />}
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: Loading skeleton**

```tsx
// apps/portal/app/(admin)/admin/calls/loading.tsx
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-8 w-72" />
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-card" />)}
    </div>
  );
}
```

- [ ] **Step 4: Verify gates** (incl. `check:routes` — `/admin/calls` is a new static route)

Run: `cd apps/portal && pnpm typecheck && pnpm lint && pnpm build && pnpm check:routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/calls apps/portal/components/app-sidebar.tsx
git commit -m "feat(admin): operator-wide /admin/calls page + sidebar nav"
```

---

## Task 11: Admin dashboard → deep-link into `/admin/calls`

Make the command-center metrics drill in. Live-calls tile → the page; Answered/Missed outcome tiles → filtered; recent feed → a "View all" link.

**Files:**
- Modify: `apps/portal/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Live-calls DashTile → href.** Add `href="/admin/calls"` to the `Live calls` `DashTile`. (Leave `Open incidents` non-link — admins have no incident route.)

- [ ] **Step 2: Outcome StatTiles → href.** In the "Tonight" outcomes strip, add `href` to Answered + Missed (import `Route`):

```tsx
import type { Route } from "next";
// ...
<StatTile value={outcomes.answered} label="Answered" href={"/admin/calls?outcome=answered" as Route} />
<StatTile value={outcomes.missed} label="Missed" alert={outcomes.missed > 0} href={"/admin/calls?outcome=missed" as Route} />
<StatTile value={outcomes.failed} label="Failed" href={"/admin/calls?outcome=failed" as Route} />
<StatTile value={formatDuration(avgPickup)} label="Avg pickup" />
<StatTile value={formatDuration(avgCallLen)} label="Avg call" />
```

- [ ] **Step 3: Recent-calls "View all".** In the `Recent calls` card header, add a link (mirror the owner overview):

```tsx
<div className="flex items-center justify-between">
  <h2 className={LABEL}>Recent calls</h2>
  <Link href="/admin/calls" className="text-sm text-accent-text hover:underline">View all</Link>
</div>
```

  (Import `Link from "next/link"`.)

- [ ] **Step 4: Verify gates + suite**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/page.tsx
git commit -m "feat(admin): dashboard metrics deep-link into /admin/calls"
```

---

## Task 12: Final verification + whole-branch review

- [ ] **Step 1: Full gate (repo + portal).**

Run: `cd apps/portal && pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm check:routes` and repo-root `pnpm test`. ALL PASS.

- [ ] **Step 2: No-hex check** on touched files:

Run: `cd apps/portal && grep -rnE "#[0-9a-fA-F]{3,6}" app/\(owner\) app/\(admin\)/admin/calls components/call components/owner/property-overview.tsx | grep -v "//"`
Expected: no new literals.

- [ ] **Step 3: Browser pass on the Vercel preview** (owner + admin):
  - **Owner** (seed OWNER): Home overview, tile drill-throughs, Calls outcome filter, blaze incidents, mobile + desktop.
  - **Admin** (seed admin): `/admin/calls` (filters compose, pagination, hotel filter, no incident link in expanded rows); dashboard Live-calls tile + Answered/Missed tiles + "View all" all land on the right filtered page.

- [ ] **Step 4: Request whole-branch review** (superpowers:requesting-code-review) before opening the PR. Address findings, then hand back for merge (do not tag/merge without Kumar).

---

## Self-review (coverage vs spec)

- Spec §2 chrome (direction A) → Task 5 (DashboardHeader on Home) + Task 6 (nav). Owner layout already has the slim white bar + seam + bottom nav (no rewrite needed).
- Spec §3 adaptive Home → Task 5 (single overview / multi cards, drill-through, quiet-night state, honest coverage pill).
- Spec §4 Calls outcome filter → Tasks 1, 3, 4.
- Spec §5 incidents blaze + red 911 tag → Task 7; the shared `CallDetailBody` incident link → Task 2.
- Spec §6.1 shared layer → Tasks 1–3. §6.2 `/admin/calls` → Task 10. §6.3 admin deep-links → Tasks 9, 11.
- Spec §7 brand colour → applied throughout (mint/blaze/teal tokens; red only on the 911 tag).
- Spec §10 verification → Tasks 8, 12 (Vercel preview, not local dev).
- **Dependencies:** T1 → T3,T4,T10. T2 → T4,T5,T10. T9 → T11. Owner (T2–T8) before admin (T9–T11). T12 last.
- **Placeholder scan:** none — every step has concrete code or an exact command.
- **Type consistency:** `Outcome` (T1) used in `CallFilters` (T3), owner Calls (T4), admin Calls (T10). `CallRowData` gains `incidentHref?` (T2) consumed in T5, T10. `CallDetail` drops `incidentId` (T2) — all three owner callers updated in T2 Step 4.

## Execution

Recommended: **subagent-driven** (fresh implementer per task, two-stage review), matching the kiosk/owner/agent repaints. Tasks 1–3 are independent foundations; 4–8 are the owner surface (verify + checkpoint); 9–11 the admin surface (separately verified); 12 closes out.
