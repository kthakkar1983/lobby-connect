# Phase 3 — Perf / Caching / Parallelization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut redundant round-trips on every protected render + the voice critical path, and fix the one count that silently truncates past PostgREST's 1000-row cap — all behavior-identical except the owner-calls list moving from infinite-accumulate to cursor pages.

**Architecture:** Two PRs. **PR-A (safe batch)** = P3-1 session `cache()`, P3-4 agent-shell dedup, P3-3 owner-home parallelize+counts, P3-6 admin count-queries + owner-calls keyset, P3-5 `unstable_cache` Sentry probe — app-internal, unit-testable, on branch `feat/phase3-perf-parallelization` (already has the spec commit). **PR-B (voice)** = P3-2 incoming-webhook restage — its own branch off `main`, opus review, **prod voice smoke** before merge. Zero migrations.

**Tech Stack:** Next.js 15.5 App Router (RSC), React `cache()`, Next `unstable_cache`, Supabase JS (PostgREST), Vitest (node + jsdom lanes), TypeScript.

**Spec:** `docs/specs/2026-06-12-phase3-perf-parallelization-design.md`

**Working directory for all commands:** `apps/portal/` (the portal app). Test runner: `npx vitest run <file>` for one file; full gate `npm test && npm run lint && npm run typecheck && npm run build`.

**Verify after every task that touches code:** `npm run typecheck` stays clean.

---

# PR-A — Safe batch (branch: `feat/phase3-perf-parallelization`)

> Already on this branch with the spec commit (`5c2f5ae`). Tasks 1–6 land here.

---

## Task 1 — P3-1: cache the session lookup (`getSessionProfile`)

**Files:**
- Create: `apps/portal/lib/auth/session.ts`
- Modify: `apps/portal/lib/auth/require-role.ts`
- Modify: `apps/portal/app/(agent)/layout.tsx`, `apps/portal/app/(owner)/layout.tsx`, `apps/portal/app/(admin)/layout.tsx` (**all three role layouts** do the duplicate name read for their header `UserMenu`). The agent dashboard *page* + admin overview *page* also do one, but those files are fully rewritten in Tasks 2 and 4 — they drop the read there.
- Test: `apps/portal/tests/lib/auth/session.test.ts` (new); keep `tests/lib/auth/require-role.test.ts` green

- [ ] **Step 1: Write the failing test** — `tests/lib/auth/session.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));

import { getSessionProfile } from "@/lib/auth/session";

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
});

describe("getSessionProfile", () => {
  it("returns null when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionProfile()).toBeNull();
  });

  it("returns the full profile shape (incl. full_name + email)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: {
        id: "u1", role: "AGENT", operator_id: "op1", active: true,
        must_change_password: false, full_name: "Alex Agent", email: "alex@x.com",
      },
    });
    const p = await getSessionProfile();
    expect(p).toMatchObject({ id: "u1", role: "AGENT", full_name: "Alex Agent", email: "alex@x.com" });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '@/lib/auth/session'`)

Run: `npx vitest run tests/lib/auth/session.test.ts`

- [ ] **Step 3: Create `lib/auth/session.ts`**

```ts
import "server-only";
import { cache } from "react";
import type { Role } from "@lc/shared";
import { createServerClient } from "@/lib/supabase/server";

export type SessionProfile = {
  id: string;
  role: Role;
  operator_id: string;
  active: boolean;
  must_change_password: boolean;
  full_name: string;
  email: string;
};

// One getUser + one profiles read per RSC render, memoized so a layout and its
// page (both gate via requireRole) don't each hit Auth + Postgres. cache() is
// React-render-scoped: it does NOT span the middleware runtime, so middleware
// keeps its own getUser (3 hops -> 2). Returns null when unauthenticated.
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, role, operator_id, active, must_change_password, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  return (data as SessionProfile | null) ?? null;
});
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/lib/auth/session.test.ts`

- [ ] **Step 5: Rewire `lib/auth/require-role.ts`** to consume the cache (redirects unchanged; return type widens)

```ts
import { redirect } from "next/navigation";
import type { Role } from "@lc/shared";
import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";

// Now includes full_name + email — additive, backward-compatible with all callers.
export type RequiredProfile = SessionProfile;

export async function requireRole(role: Role): Promise<RequiredProfile> {
  const profile = await getSessionProfile();

  if (!profile || !profile.active) {
    redirect("/sign-in");
  }
  if (profile.must_change_password) {
    redirect("/onboarding");
  }
  if (profile.role !== role) {
    redirect("/");
  }
  return profile;
}
```

- [ ] **Step 6: Run the auth suite — keep it green** (fixtures may need `full_name`/`email` if a test deep-equals the returned profile)

Run: `npx vitest run tests/lib/auth/require-role.test.ts`
Expected: PASS. If a test asserts a 5-field object, add `full_name`/`email` to its mock profile fixture.

- [ ] **Step 7: Drop the redundant name reads in the two layout callers** (the agent page + admin overview drop theirs inside their own rewrites — Tasks 2 and 4)

`app/(owner)/layout.tsx` — delete the `createServerClient` import + the `identity` fetch; use the profile:
```tsx
const profile = await requireRole("OWNER");
// (remove the createServerClient import + the identity query block)
…
<UserMenu fullName={profile.full_name} email={profile.email} role="OWNER" />
```

`app/(agent)/layout.tsx` — delete only the `profile` fetch (the assignments + properties fetches stay here until Task 2, so `createServerClient` is still imported):
```tsx
const actor = await requireRole("AGENT");
// (delete: const { data: profile } = await supabase.from("profiles").select("full_name, email")…)
…
<UserMenu fullName={actor.full_name} email={actor.email} role="AGENT" />
```

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean. (Agent page + admin overview still do their own name reads — unchanged here; the widened `requireRole` return is backward-compatible.)
```bash
git add lib/auth/session.ts lib/auth/require-role.ts "app/(owner)/layout.tsx" "app/(agent)/layout.tsx" tests/lib/auth/session.test.ts
git commit -m "perf(P3-1): cache() session lookup; drop duplicate name reads in layouts"
```

---

## Task 2 — P3-4: dedup the agent shell (`getAgentCoverage`)

**Files:**
- Create: `apps/portal/lib/auth/agent-coverage.ts`
- Modify: `apps/portal/app/(agent)/layout.tsx`, `apps/portal/app/(agent)/agent/page.tsx`
- Test: `apps/portal/tests/lib/auth/agent-coverage.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/lib/auth/agent-coverage.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const assignmentsResult = vi.fn();
const propertiesResult = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ is: () => assignmentsResult() }),
        in: () => ({ order: () => propertiesResult() }),
      }),
    }),
  }),
}));

import { getAgentCoverage } from "@/lib/auth/agent-coverage";

beforeEach(() => {
  assignmentsResult.mockReset();
  propertiesResult.mockReset();
});

describe("getAgentCoverage", () => {
  it("returns empty when the agent has no active assignments", async () => {
    assignmentsResult.mockResolvedValue({ data: [] });
    expect(await getAgentCoverage("a1")).toEqual({ ids: [], properties: [] });
  });

  it("resolves assigned property ids -> property rows", async () => {
    assignmentsResult.mockResolvedValue({ data: [{ property_id: "p1" }, { property_id: "p2" }] });
    propertiesResult.mockResolvedValue({
      data: [
        { id: "p1", name: "Hotel One", timezone: "America/Chicago" },
        { id: "p2", name: "Hotel Two", timezone: "America/New_York" },
      ],
    });
    const cov = await getAgentCoverage("a1");
    expect(cov.ids).toEqual(["p1", "p2"]);
    expect(cov.properties).toHaveLength(2);
    expect(cov.properties[0]).toMatchObject({ id: "p1", timezone: "America/Chicago" });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `npx vitest run tests/lib/auth/agent-coverage.test.ts`

- [ ] **Step 3: Create `lib/auth/agent-coverage.ts`**

```ts
import "server-only";
import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";

export type AgentCoverage = {
  ids: string[];
  properties: { id: string; name: string; timezone: string }[];
};

// Active assignments -> covered properties for one agent, memoized per render so
// the agent layout and the agent page share a single pair of reads.
export const getAgentCoverage = cache(async (agentId: string): Promise<AgentCoverage> => {
  const supabase = await createServerClient();
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id")
    .eq("primary_agent_id", agentId)
    .is("effective_until", null);
  const ids = (assignments ?? []).map((a) => a.property_id);
  if (ids.length === 0) return { ids: [], properties: [] };
  const { data: props } = await supabase
    .from("properties")
    .select("id, name, timezone")
    .in("id", ids)
    .order("name");
  return { ids, properties: (props ?? []) as AgentCoverage["properties"] };
});
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/lib/auth/agent-coverage.test.ts`

- [ ] **Step 5: Rewire `app/(agent)/layout.tsx`** — replace the assignments + properties fetch with the cache; drop `createServerClient`

```tsx
import Link from "next/link";
import { Building2 } from "lucide-react";
import { SkipLink } from "@/components/skip-link";
import { requireRole } from "@/lib/auth/require-role";
import { getAgentCoverage } from "@/lib/auth/agent-coverage";
import { Softphone } from "@/components/softphone/softphone";
import { VideoCallHost } from "@/components/video-call/video-call-host";
import { Wordmark } from "@/components/brand/wordmark";
import { UserMenu } from "@/components/user-menu";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/copy";
import { LineStatusProvider } from "@/components/dashboard/line-status-provider";

export default async function AgentLayout({ children }: { readonly children: React.ReactNode }) {
  const actor = await requireRole("AGENT");
  const { properties: coverage } = await getAgentCoverage(actor.id);
  // …JSX unchanged except: <UserMenu fullName={actor.full_name} email={actor.email} role="AGENT" />
  // and the coverage list maps `coverage` (was the local `coverage` var) as before.
}
```
(The `<header>`/`<aside>` JSX is unchanged; only the two data lines + the `UserMenu` props change.)

- [ ] **Step 6: Rewire `app/(agent)/agent/page.tsx`** — coverage from the cache, name from the actor, calls fetch stays page-local

```tsx
const actor = await requireRole("AGENT");
const supabase = await createServerClient();
const now = new Date();
const fullName = actor.full_name || "Agent";
const firstName = fullName.split(/\s+/)[0] ?? fullName;
const since = new Date(now.getTime() - 48 * 3600_000).toISOString();

const [coverage, { data: handledRaw }] = await Promise.all([
  getAgentCoverage(actor.id), // cached — shares the layout's reads
  supabase
    .from("calls")
    .select("id, property_id, ring_started_at, answered_at, duration_seconds, room_number")
    .eq("handled_by_user_id", actor.id)
    .gte("ring_started_at", since)
    .order("ring_started_at", { ascending: false }),
]);

const covered = coverage.properties.map((p) => ({ id: p.id, name: p.name, timeZone: p.timezone }));
// …rest of the page (tzById/nameById/handled/stat tiles/recent) unchanged.
```
(Delete the old Group A profile fetch + Group B properties fetch.)

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add lib/auth/agent-coverage.ts "app/(agent)/layout.tsx" "app/(agent)/agent/page.tsx" tests/lib/auth/agent-coverage.test.ts
git commit -m "perf(P3-4): cache() agent coverage shared by layout + page"
```

---

## Task 3 — P3-3: parallelize owner home + tz count/last-call

**Files:**
- Create: `apps/portal/lib/calls/today-window.ts`
- Modify: `apps/portal/app/(owner)/owner/page.tsx`
- Test: `apps/portal/tests/lib/calls/today-window.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/lib/calls/today-window.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { startOfTodayUtc } from "@/lib/calls/today-window";

describe("startOfTodayUtc", () => {
  it("UTC: midnight of the same calendar day", () => {
    expect(startOfTodayUtc("UTC", new Date("2026-06-12T15:30:00Z"))).toBe("2026-06-12T00:00:00.000Z");
  });
  it("America/Chicago (CDT, UTC-5 in June): local midnight is 05:00Z", () => {
    expect(startOfTodayUtc("America/Chicago", new Date("2026-06-12T15:30:00Z"))).toBe(
      "2026-06-12T05:00:00.000Z",
    );
  });
  it("America/New_York (EDT, UTC-4 in June): local midnight is 04:00Z", () => {
    expect(startOfTodayUtc("America/New_York", new Date("2026-06-12T15:30:00Z"))).toBe(
      "2026-06-12T04:00:00.000Z",
    );
  });
  it("just-after-local-midnight still maps to the same local day's midnight", () => {
    // 2026-06-12T05:30Z = 00:30 CDT June 12 -> start is 05:00Z June 12.
    expect(startOfTodayUtc("America/Chicago", new Date("2026-06-12T05:30:00Z"))).toBe(
      "2026-06-12T05:00:00.000Z",
    );
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `npx vitest run tests/lib/calls/today-window.test.ts`

- [ ] **Step 3: Create `lib/calls/today-window.ts`**

```ts
// UTC ISO instant for the start of "today" (local midnight) in the given tz.
// Used as a count-query lower bound so "calls today" is computed in Postgres
// instead of shipping rows to JS. Correct for US time zones (DST transitions at
// 02:00, never midnight); a hypothetical midnight-DST zone could be off by 1h.
export function startOfTodayUtc(tz: string, now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD" local date in tz
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0); // wall-clock midnight as if UTC
  const offsetMs = tzOffsetMs(new Date(guess), tz); // correct by the zone offset
  return new Date(guess - offsetMs).toISOString();
}

// Offset (ms) of tz from UTC at the given instant: format the instant as tz
// wall-clock, read it back as if it were UTC, subtract.
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/lib/calls/today-window.test.ts`

- [ ] **Step 5: Rewrite the data layer of `app/(owner)/owner/page.tsx`** (the `return (...)` JSX is unchanged — it already consumes `cards` with `{id,name,agent,todayCount,openCount,lastCall,live}`)

Replace imports + the body from `requireRole` down to the `cards` array with:

```tsx
import type { ProfileStatus, IncidentStatus } from "@lc/shared";
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { presenceLabel, presenceDotClass, isLivePresence, formatTimeOnly } from "@/lib/owner/format";
import { effectivePresence } from "@/lib/voice/presence";
import { countOpenIncidents } from "@/lib/owner/summary";
import { startOfTodayUtc } from "@/lib/calls/today-window";
// (drop countTodayCalls + latestCallTime imports — replaced below)

type SupabaseServer = Awaited<ReturnType<typeof createServerClient>>;

async function resolveAgents(
  supabase: SupabaseServer,
  propIds: string[],
  now: Date,
): Promise<Map<string, { full_name: string; status: ProfileStatus }>> {
  const out = new Map<string, { full_name: string; status: ProfileStatus }>();
  if (propIds.length === 0) return out;
  const { data: assignments } = await supabase
    .from("property_assignments")
    .select("property_id, primary_agent_id")
    .in("property_id", propIds)
    .is("effective_until", null);
  const agentIds = [...new Set((assignments ?? []).map((a) => a.primary_agent_id))];
  const raw = new Map<string, { full_name: string; status: ProfileStatus; last_seen_at: string | null }>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabase
      .from("profiles")
      .select("id, full_name, status, last_seen_at")
      .in("id", agentIds);
    for (const a of agents ?? []) raw.set(a.id, { full_name: a.full_name, status: a.status, last_seen_at: a.last_seen_at });
  }
  for (const a of assignments ?? []) {
    const r = raw.get(a.primary_agent_id);
    if (r) out.set(a.property_id, { full_name: r.full_name, status: effectivePresence(r.status, r.last_seen_at, now.getTime()) });
  }
  return out;
}

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

  // Stage 2 — all independent of each other, only depend on propIds.
  const [agentByProperty, perProperty, openRows] = await Promise.all([
    resolveAgents(supabase, propIds, now),
    Promise.all(
      props.map(async (p) => {
        const [{ count }, { data: last }] = await Promise.all([
          supabase
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("property_id", p.id)
            .gte("ring_started_at", startOfTodayUtc(p.timezone, now)),
          supabase
            .from("calls")
            .select("ring_started_at")
            .eq("property_id", p.id)
            .order("ring_started_at", { ascending: false })
            .limit(1),
        ]);
        return {
          id: p.id,
          todayCount: count ?? 0,
          lastCall: last && last[0] ? formatTimeOnly(last[0].ring_started_at, p.timezone) : "—",
        };
      }),
    ),
    propIds.length
      ? supabase.from("incidents").select("property_id, status").in("property_id", propIds).neq("status", "RESOLVED")
      : Promise.resolve({ data: [] as { property_id: string; status: IncidentStatus }[] }),
  ]);

  const statByProperty = new Map(perProperty.map((s) => [s.id, s]));
  const openIncidents = openRows.data ?? [];

  const cards = props.map((p) => {
    const agent = agentByProperty.get(p.id) ?? null;
    const stat = statByProperty.get(p.id);
    const openCount = countOpenIncidents(openIncidents.filter((i) => i.property_id === p.id));
    return {
      id: p.id,
      name: p.name,
      agent,
      todayCount: stat?.todayCount ?? 0,
      openCount,
      lastCall: stat?.lastCall ?? "—",
      live: agent ? isLivePresence(agent.status) : false,
    };
  });

  // return ( … ) — JSX UNCHANGED from the current file.
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/calls/today-window.ts "app/(owner)/owner/page.tsx" tests/lib/calls/today-window.test.ts
git commit -m "perf(P3-3): parallelize owner home; tz count + last-call queries"
```

---

## Task 4 — P3-6a: admin overview count queries

**Files:**
- Modify: `apps/portal/app/(admin)/admin/page.tsx`
- Reuses `lib/calls/today-window.ts` (Task 3)

- [ ] **Step 1: Replace the data layer of `app/(admin)/admin/page.tsx`** (drop the `me` query (Task 1) + the 48h calls row-haul; incidents → `head:true`; per-property today via count queries). JSX from `return (` down is unchanged — it reads `callsToday`, `openIncidents`, `todayByProperty`, `onlineAgents`, `acceptingCount`, `firstName`, `agentByProperty`.

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/owner/stat-tile";
import { GreetingLine } from "@/components/dashboard/greeting-line";
import { AvailabilityToggle } from "./availability-cards";
import { countOnlineAgents } from "@/lib/dashboard/presence";
import { startOfTodayUtc } from "@/lib/calls/today-window";
import { presenceDotClass, presenceLabel } from "@/lib/owner/format";
import { isStale } from "@/lib/voice/presence";
import { cn } from "@/lib/utils";
import type { ProfileStatus } from "@lc/shared";
// (drop the countToday import — no longer used)

export default async function AdminOverviewPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();
  const now = new Date();

  // Stage 1 — operator-scoped reads, independent of property ids.
  const [
    { data: properties },
    { data: agents },
    { count: openIncidents },
    { data: avail },
    { data: assigns },
  ] = await Promise.all([
    supabase.from("properties").select("id, name, timezone").eq("operator_id", actor.operator_id).eq("active", true).order("name"),
    supabase.from("profiles").select("status, last_seen_at").eq("operator_id", actor.operator_id).eq("role", "AGENT").eq("active", true),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("operator_id", actor.operator_id).eq("status", "OPEN"),
    supabase.from("admin_call_availability").select("property_id, accepting_calls").eq("profile_id", actor.id),
    supabase.from("property_assignments").select("property_id, primary_agent_id").eq("operator_id", actor.operator_id).is("effective_until", null),
  ]);

  const props = properties ?? [];

  // Stage 2 — per-property "today" counts (count queries; tz-aware window).
  const todayCounts = new Map<string, number>(
    await Promise.all(
      props.map(async (p) => {
        const { count } = await supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("property_id", p.id)
          .gte("ring_started_at", startOfTodayUtc(p.timezone, now));
        return [p.id, count ?? 0] as [string, number];
      }),
    ),
  );
  const callsToday = [...todayCounts.values()].reduce((a, b) => a + b, 0);

  // Agent profiles (2-query pattern) — unchanged.
  const agentIds = [...new Set((assigns ?? []).map((a) => a.primary_agent_id))];
  let agentProfiles: { id: string; full_name: string; status: ProfileStatus; last_seen_at: string | null }[] = [];
  if (agentIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name, status, last_seen_at").in("id", agentIds);
    agentProfiles = (data ?? []) as typeof agentProfiles;
  }
  const profileById = new Map(agentProfiles.map((p) => [p.id, p]));

  const onlineAgents = countOnlineAgents(
    (agents ?? []) as { status: ProfileStatus; last_seen_at: string | null }[],
    now.getTime(),
  );
  const acceptingMap = new Map((avail ?? []).map((a) => [a.property_id, a.accepting_calls]));
  const acceptingCount = props.filter((p) => acceptingMap.get(p.id)).length;
  const agentByProperty = new Map((assigns ?? []).map((a) => [a.property_id, profileById.get(a.primary_agent_id) ?? null]));
  const todayByProperty = (id: string) => todayCounts.get(id) ?? 0;
  const firstName = (actor.full_name || "Admin").split(/\s+/)[0] ?? "Admin";

  // return ( … ) — JSX UNCHANGED. `openIncidents` is now the count (number | null);
  // it is already used as `value={openIncidents}` + `alert={openIncidents > 0}`, so
  // guard once: const open = openIncidents ?? 0; and use `open` in those two spots.
```

- [ ] **Step 2: Update the two `openIncidents` JSX references** to the guarded count

In the `return`, change the open-incidents `StatTile` to:
```tsx
<StatTile value={openIncidents ?? 0} label="Open incidents" alert={(openIncidents ?? 0) > 0} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (no remaining `countToday` / `callsWithTz` references).

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/page.tsx"
git commit -m "perf(P3-6a): admin overview via count queries (no row-ship, no 1000-cap)"
```

---

## Task 5 — P3-6b: owner-calls keyset pagination

**Files:**
- Create: `apps/portal/lib/owner/calls-cursor.ts`
- Modify: `apps/portal/app/(owner)/owner/calls/page.tsx`
- Test: `apps/portal/tests/lib/owner/calls-cursor.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/lib/owner/calls-cursor.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";

describe("calls-cursor", () => {
  it("round-trips encode -> decode", () => {
    const row = { created_at: "2026-06-12T05:00:00.000Z", id: "11111111-2222-3333-4444-555555555555" };
    const enc = encodeCursor(row);
    expect(decodeCursor(enc)).toEqual({ at: row.created_at, id: row.id });
  });
  it("decodes null/empty/malformed to null", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nodelimiter")).toBeNull();
    expect(decodeCursor("~abc")).toBeNull();
    expect(decodeCursor("abc~")).toBeNull();
  });
  it("builds the keyset .or() filter (strictly older under created_at desc, id desc)", () => {
    expect(keysetOrFilter({ at: "2026-06-12T05:00:00.000Z", id: "id9" })).toBe(
      "created_at.lt.2026-06-12T05:00:00.000Z,and(created_at.eq.2026-06-12T05:00:00.000Z,id.lt.id9)",
    );
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `npx vitest run tests/lib/owner/calls-cursor.test.ts`

- [ ] **Step 3: Create `lib/owner/calls-cursor.ts`**

```ts
export type CallCursor = { at: string; id: string };

// "<created_at>~<id>" — created_at is an ISO timestamp (contains no '~'); id is a uuid.
export function encodeCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}~${row.id}`;
}

export function decodeCursor(raw: string | undefined | null): CallCursor | null {
  if (!raw) return null;
  const i = raw.indexOf("~");
  if (i <= 0 || i === raw.length - 1) return null;
  return { at: raw.slice(0, i), id: raw.slice(i + 1) };
}

// PostgREST .or() expressing "strictly older than (at, id)" under (created_at desc, id desc).
export function keysetOrFilter(c: CallCursor): string {
  return `created_at.lt.${c.at},and(created_at.eq.${c.at},id.lt.${c.id})`;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/lib/owner/calls-cursor.test.ts`

- [ ] **Step 5: Convert `app/(owner)/owner/calls/page.tsx` to cursor pages.** Five edits; everything else (handler 2-query, incident map, day-grouping, `CallRow` list) is unchanged.

(a) Imports + page size — add cursor helpers, drop the `DEFAULT_LIMIT` growing model:
```tsx
import { encodeCursor, decodeCursor, keysetOrFilter } from "@/lib/owner/calls-cursor";
const PAGE_SIZE = 50;
```

(b) searchParams — `before` replaces `limit`:
```tsx
}: {
  searchParams: Promise<{ property?: string; before?: string; channel?: string }>;
}) {
  const { property, before, channel: channelParam } = await searchParams;
  const cursor = decodeCursor(before);
```
(Delete the `limit`/`limitParam` lines.)

(c) The calls query — add the `id` tiebreaker order + `created_at` to the select + the keyset filter:
```tsx
let callsQuery = supabase
  .from("calls")
  .select(
    "id, created_at, property_id, channel, state, ring_started_at, duration_seconds, handled_by_user_id, room_number, caller_number, notes, recording_url",
  )
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(PAGE_SIZE);

if (cursor) callsQuery = callsQuery.or(keysetOrFilter(cursor));
```
(Property/channel `.eq`/`.in` filters below are unchanged.)

> **Verify the `.or()` executes against PostgREST** (exercised by the local smoke in Task 7 Step 3 — click "Older" and confirm the next 50 load with no dup/skip). The ISO `created_at` value contains `:` and `.` but no `,`/`(`/`)`, so it parses as a bare filter value. If a future Postgres/PostgREST version rejects the bare timestamp, the fix is to wrap the value in double quotes inside `keysetOrFilter` (e.g. `created_at.lt."<at>"`) — update the unit test's expected string to match.

(d) `buildHref` — `before` replaces `limit`:
```tsx
const buildHref = (next: { property?: string | null; channel?: CallChannel | null; before?: string | null }) => {
  const sp = new URLSearchParams();
  const p = next.property === undefined ? activeProperty : next.property;
  const ch = next.channel === undefined ? activeChannel : next.channel;
  if (p) sp.set("property", p);
  if (ch) sp.set("channel", ch);
  if (next.before) sp.set("before", next.before);
  const qs = sp.toString();
  return `/owner/calls${qs ? `?${qs}` : ""}`;
};
const lastRow = rows[rows.length - 1];
const olderHref = lastRow ? buildHref({ before: encodeCursor({ created_at: lastRow.created_at, id: lastRow.id }) }) : null;
const newestHref = buildHref({ before: null });
```
(Filter chips that call `buildHref({ property })` / `buildHref({ channel })` now also clear `before` implicitly — they don't pass it, and `before` defaults to absent unless set. Confirm chips read correctly: a filter change should reset to the newest page, which this does since they omit `before`.)

(e) Footer — replace the single "Load more" with Newest / Older:
```tsx
<div className="flex items-center justify-between">
  {cursor ? (
    <Button asChild variant="ghost" size="sm">
      <Link href={newestHref as never}>← Newest</Link>
    </Button>
  ) : <span />}
  {rows.length === PAGE_SIZE && olderHref ? (
    <Button asChild variant="outline" size="sm">
      <Link href={olderHref as never}>Older →</Link>
    </Button>
  ) : <span />}
</div>
```
(Delete the old `moreHref` + the `rows.length === limit` "Load more" block.)

- [ ] **Step 6: Typecheck + lint + the cursor test**

Run: `npm run typecheck && npm run lint && npx vitest run tests/lib/owner/calls-cursor.test.ts`
Expected: clean + PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/owner/calls-cursor.ts "app/(owner)/owner/calls/page.tsx" tests/lib/owner/calls-cursor.test.ts
git commit -m "perf(P3-6b): owner calls keyset cursor pages (bounds AutoRefresh to one page)"
```

---

## Task 6 — P3-5: cache the Sentry probe

**Files:**
- Modify: `apps/portal/lib/sentry/errors.ts`
- Modify: `apps/portal/app/(admin)/admin/status/page.tsx`

- [ ] **Step 1: Add the cached wrapper to `lib/sentry/errors.ts`** (append; leave `getRecentErrorCount` untouched so its unit tests stand)

```ts
import { unstable_cache } from "next/cache";

// /admin/status refreshes every 20s; without this each tick (per tab) hit the
// Sentry API. Cache the count for 60s so it's ~1 call/min regardless of viewers.
// The card is ≤60s stale — fine for an at-a-glance health dot.
export const getCachedErrorCount = unstable_cache(
  async () => getRecentErrorCount(),
  ["status:sentry-error-count"],
  { revalidate: 60 },
);
```

- [ ] **Step 2: Rewire `app/(admin)/admin/status/page.tsx`**

Change the import (line 3) and the call (line 39):
```tsx
import { getCachedErrorCount } from "@/lib/sentry/errors";
// …
const errorCount = await getCachedErrorCount();
```

- [ ] **Step 3: Typecheck + the existing Sentry test still green**

Run: `npm run typecheck && npx vitest run tests/lib/sentry`
Expected: clean + PASS (no change to `getRecentErrorCount`).

- [ ] **Step 4: Commit**

```bash
git add lib/sentry/errors.ts "app/(admin)/admin/status/page.tsx"
git commit -m "perf(P3-5): unstable_cache the Sentry error-count probe (60s)"
```

---

## Task 7 — PR-A gate + push

- [ ] **Step 1: Full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all green; net test count up (4 new unit suites). If `npm run build` flags an `unstable_cache` usage warning, confirm it's non-fatal.

- [ ] **Step 2: Push the branch + open PR-A**

```bash
git push -u origin feat/phase3-perf-parallelization
gh pr create --title "Phase 3 (safe batch): caching + parallelization + counts + keyset" \
  --body "P3-1/P3-3/P3-4/P3-5/P3-6. Behavior-identical except owner-calls list -> cursor pages. Zero migrations. Spec: docs/specs/2026-06-12-phase3-perf-parallelization-design.md"
```

- [ ] **Step 3: Local smoke (recommended — also the keyset acceptance check)** — `npm run dev`, sign in as each role, confirm: agent dashboard + admin overview stats render with the same numbers as before; owner home cards (today/last-call/open) match; on owner Calls, **click "Older →" to load page 2 and confirm the next 50 older calls appear with no duplicate or skipped row vs page 1** (this exercises the keyset `.or()` filter against the real DB), then "← Newest" returns to page 1; the property/channel filter chips reset to page 1 and still filter; `/admin/status` still shows the error count.

---

# PR-B — Voice webhook restage (branch off `main`)

> **Higher risk: the live inbound voice path.** opus implementer + opus review. Verified by a **prod voice smoke**, since Twilio only points at the prod webhook.

- [ ] **Step 0: Branch off `main`**

```bash
git checkout main && git pull && git checkout -b feat/phase3-voice-webhook
```

## Task 8 — P3-2: restage `incoming/route.ts` (8→4 hops, detach heartbeat)

**Files:**
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts`
- Test: extend `apps/portal/tests/app/twilio/incoming.test.ts`

- [ ] **Step 1: Add the detach test + heartbeat mock to `tests/app/twilio/incoming.test.ts`**

At the top with the other `vi.mock`s, add a controllable heartbeat mock:
```ts
const recordHeartbeat = vi.fn<() => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/health/heartbeat", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordHeartbeat: (...a: any[]) => (recordHeartbeat as any)(...a),
}));
```
In `beforeEach`, add: `recordHeartbeat.mockReset(); recordHeartbeat.mockResolvedValue(undefined);`

Add the test:
```ts
it("does not let a failing heartbeat divert the response (detached, off critical path)", async () => {
  recordHeartbeat.mockImplementationOnce(() => Promise.reject(new Error("boom")));
  canned.property = { id: "p1", operator_id: "op1", active: true, name: "Hotel One" };
  canned.assignment = { primary_agent_id: "a1" };
  canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
  const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
  const xml = await res.text();
  expect(xml).toContain("<Identity>lc_a1</Identity>"); // dialed, not apology
  expect(insertSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the suite — expect the new test to FAIL** (current code `await`s the heartbeat inside `try`, so a rejection is caught → apology TwiML → no `<Identity>`)

Run: `npx vitest run tests/app/twilio/incoming.test.ts`
Expected: the new test fails (`<Identity>` not found); the other 7 pass.

- [ ] **Step 3: Restage `app/api/twilio/voice/incoming/route.ts`** (replace the body below `const callSid …`; imports + constants unchanged)

```ts
    const admin = createAdminClient({ timeoutMs: SUPABASE_TIMEOUT_MS });

    // 1. Property gate (everything needs operator_id / property.id).
    const { data: property } = await admin
      .from("properties")
      .select("id, operator_id, active, name")
      .eq("routing_did", to)
      .maybeSingle();
    if (!property || !property.active) {
      return twimlResponse(buildNotInServiceTwiml(APOLOGY_MESSAGE));
    }

    // Best-effort heartbeat — detached so it never sits on the guest's critical path.
    void recordHeartbeat(property.operator_id, "twilio_webhook").catch(() => {});

    // 2–4. Independent reads in parallel.
    const [existing, primaryAgent, availableAdmins] = await Promise.all([
      admin
        .from("calls")
        .select("id")
        .eq("twilio_call_sid", callSid)
        .maybeSingle()
        .then((r) => r.data as { id: string } | null),
      resolvePrimaryAgent(admin, property.id),
      resolveAvailableAdmins(admin, property.id, property.operator_id),
    ]);

    const targets = planDial({ primaryAgent, availableAdmins });

    // 5. Record the call (idempotent on CallSid).
    let callId = existing?.id ?? "";
    if (!existing) {
      const { data: inserted } = await admin
        .from("calls")
        .insert({
          operator_id: property.operator_id,
          property_id: property.id,
          channel: "AUDIO",
          state: targets.length === 0 ? "NO_ANSWER" : "RINGING",
          twilio_call_sid: callSid,
          caller_number: from,
        })
        .select("id")
        .single();
      callId = inserted?.id ?? "";
    }

    // 6. TwiML.
    const actionUrl = `${new URL(publicUrlFromRequest(request)).origin}/api/twilio/voice/dial-result`;
    return twimlResponse(
      buildIncomingTwiml(targets, {
        greeting: GREETING,
        timeoutSeconds: RING_TIMEOUT_SECONDS,
        actionUrl,
        apologyMessage: APOLOGY_MESSAGE,
        callId,
        propertyName: property.name,
      }),
    );
  } catch (err) {
    console.error("[voice/incoming] unhandled error:", err);
    return twimlResponse(buildApologyTwiml(APOLOGY_MESSAGE));
  }
}

type Admin = ReturnType<typeof createAdminClient>;

// Today's exact query logic, lifted into named readers so the two 2-deep chains
// run in parallel. Behavior-identical to the prior inline blocks.
async function resolvePrimaryAgent(admin: Admin, propertyId: string): Promise<DialCandidate | null> {
  const { data: assignment } = await admin
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", propertyId)
    .is("effective_until", null)
    .maybeSingle();
  if (!assignment?.primary_agent_id) return null;
  const { data: agent } = await admin
    .from("profiles")
    .select("id, twilio_identity, active")
    .eq("id", assignment.primary_agent_id)
    .maybeSingle();
  if (agent?.active && agent.twilio_identity) {
    return { id: agent.id, twilioIdentity: agent.twilio_identity };
  }
  return null;
}

async function resolveAvailableAdmins(admin: Admin, propertyId: string, operatorId: string): Promise<DialCandidate[]> {
  const { data: availRows } = await admin
    .from("admin_call_availability")
    .select("profile_id")
    .eq("property_id", propertyId)
    .eq("accepting_calls", true);
  const ids = (availRows ?? []).map((r: { profile_id: string }) => r.profile_id);
  if (ids.length === 0) return [];
  const { data: admins } = await admin
    .from("profiles")
    .select("id, twilio_identity, active, role, operator_id")
    .in("id", ids)
    .eq("active", true)
    .eq("role", "ADMIN")
    .eq("operator_id", operatorId);
  const out: DialCandidate[] = [];
  for (const a of (admins ?? []) as Array<{ id: string; twilio_identity: string | null }>) {
    if (a.twilio_identity) out.push({ id: a.id, twilioIdentity: a.twilio_identity });
  }
  return out;
}
```

- [ ] **Step 4: Run the suite — expect ALL PASS** (the 7 originals prove behavior-identical; the new one proves detachment)

Run: `npx vitest run tests/app/twilio/incoming.test.ts`
Expected: 8 pass.

- [ ] **Step 5: Full gate + commit**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
```bash
git add "app/api/twilio/voice/incoming/route.ts" tests/app/twilio/incoming.test.ts
git commit -m "perf(P3-2): restage incoming webhook 8->4 hops; detach heartbeat"
git push -u origin feat/phase3-voice-webhook
gh pr create --title "Phase 3 (voice): incoming-webhook restage (8->4 hops)" \
  --body "P3-2/P4/S5. Behavior-identical query logic; Promise.all the 3 independent reads; detach the best-effort heartbeat. Needs prod voice smoke before merge. Spec: docs/specs/2026-06-12-phase3-perf-parallelization-design.md"
```

- [ ] **Step 6: PROD VOICE SMOKE (required before merge).** Deploy the branch (or merge to a preview), then with an agent/admin signed in (softphone registered):
  1. Call the property's `routing_did` → softphone rings (ringback should be audibly prompt) → answer → two-way audio → `calls` row RINGING→IN_PROGRESS→COMPLETED with `answered_at`/`duration_seconds`.
  2. No-answer case (nobody accepting) → apology TwiML + `NO_ANSWER` row.
  3. Confirm `health_signals.twilio_webhook` still updates (the detached heartbeat still lands, just off the response path).
  Only merge PR-B after this passes.

---

## Self-review notes (author checklist — completed)

- **Spec coverage:** P3-1 → Task 1; P3-4 → Task 2; P3-3 → Task 3; P3-6 counts → Task 4; P3-6 keyset → Task 5; P3-5 → Task 6; P3-2 → Task 8. All six spec changes mapped.
- **No migrations** introduced (matches spec §1).
- **Type consistency:** `getSessionProfile`/`SessionProfile` (Task 1) reused by `requireRole`; `getAgentCoverage`/`AgentCoverage` (Task 2); `startOfTodayUtc` (Task 3) reused by Task 4; `encodeCursor`/`decodeCursor`/`keysetOrFilter` + `CallCursor` consistent (Task 5); `getCachedErrorCount` (Task 6); `Admin` + `DialCandidate` (Task 8).
- **Behavior-identical guarantee:** the only rendered change is owner Calls (accumulate → pages, spec §6). Admin/owner-home stats use count queries that reproduce the prior integers; the voice route keeps identical `planDial` inputs/TwiML/insert (7 original tests unchanged).
