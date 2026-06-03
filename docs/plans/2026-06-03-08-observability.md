# Observability (Plan 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins three observability surfaces — Sentry error tracking (both apps, PII-scrubbed), an admin `/audit` log viewer, and an admin `/status` health page driven by a generic heartbeat registry plus live probes.

**Architecture:** Sentry SDKs wrap both apps with a shared `beforeSend` scrubber. A new `health_signals` table is the push-signal registry (Twilio webhook + cron self-report a `last_ok_at`); `/status` reads it plus two live pull-probes (Supabase `select 1`, Sentry issue count). `/audit` is a read viewer over the already-populated `audit_logs` table. All business logic lives in TDD'd pure helpers under `lib/`; pages/routes are thin.

**Tech Stack:** Next.js 15 App Router (RSC, `instrumentation*.ts`), `@sentry/nextjs` (portal) + `@sentry/react` (kiosk), `@vercel/analytics`, Supabase (Postgres RLS), Tailwind + shadcn (`Table`, `Select`, `Badge`, `Skeleton`), lucide-react, Vitest.

**Spec:** `docs/specs/2026-06-03-08-observability-design.md`

---

## Conventions for every task

- **Commands** (run from `apps/portal/` unless noted): `pnpm test` (all Vitest), `pnpm test -- <path>` (one file), `pnpm typecheck`, `pnpm lint`. Kiosk commands run from `apps/kiosk/`. Monorepo-wide: `pnpm -w test`, `pnpm -w typecheck`.
- **Imports:** shared types from `@lc/shared`; portal app code via `@/…`.
- **Tokens only** — no raw hex. Use `text-foreground`, `text-text-muted`, `border-border`, `bg-card`, `text-primary`. The one sanctioned exception is the `/status` status dots, which use Tailwind palette utilities (`bg-emerald-500`/`bg-amber-500`/`bg-red-500`/`bg-muted-foreground`) — conventional for health indicators, the same way `Badge` variants encode state.
- **Typed-routes:** new internal routes use the existing `NavItem`/`Link` pattern; pass `as never` only where a `Link` references a not-yet-created route within the same task.
- **Sentry env is optional-by-design:** read Sentry vars directly via `process.env` (NOT through `lib/env.ts`, which throws on missing). A missing DSN makes the SDK a safe no-op; a missing token makes `getRecentErrorCount()` return `null`. Never add Sentry vars to the `required(...)` list in `lib/env.ts`.
- **Audit:** `/audit` and `/status` are read-only — no `logAuditEvent` calls in this plan.

## Seed fixtures (local dev)

| Thing | UUID |
|---|---|
| Operator | `00000000-0000-0000-0000-0000000000a0` |
| Admin (`admin@lobbyconnect.local` / `localdev123`) | (see `supabase/seed.sql`) |

## File structure (locked)

```
supabase/migrations/0011_health_signals.sql              ← table + admin-select RLS                     (Task 1)
packages/shared/src/supabase-types.ts                    ← + health_signals Row/Insert/Update (manual)   (Task 1)
apps/portal/
  lib/sentry/
    scrub.ts        scrubEvent, scrubPii, PHONE_RE        (+ tests/sentry/scrub.test.ts)                 (Task 2)
    errors.ts       getRecentErrorCount                   (+ tests/sentry/errors.test.ts)                 (Task 3)
  lib/health/
    heartbeat.ts    recordHeartbeat                       (+ tests/health/heartbeat.test.ts)             (Task 4)
  lib/status/
    signals.ts      SIGNAL_SPECS, classify*               (+ tests/status/signals.test.ts)               (Task 5)
  lib/audit/
    query.ts        validateAuditFilter, mergeActorNames  (+ tests/audit/query.test.ts)                  (Task 6)
  instrumentation.ts            ← Sentry register + onRequestError                                        (Task 7)
  instrumentation-client.ts     ← Sentry browser init                                                     (Task 7)
  sentry.server.config.ts       ← Sentry server init                                                      (Task 7)
  sentry.edge.config.ts         ← Sentry edge init                                                         (Task 7)
  next.config.ts                ← withSentryConfig wrap                                                    (Task 7)
  app/layout.tsx                ← <Analytics />                                                            (Task 7)
  .env.example                  ← Sentry vars                                                              (Task 7)
  app/api/twilio/voice/incoming/route.ts   ← + best-effort twilio_webhook heartbeat                       (Task 8)
  app/api/cron/mark-stale-offline/route.ts ← + per-operator cron heartbeat                                (Task 8)
  tests/app/cron/heartbeat.test.ts         ← cron heartbeat upsert test                                   (Task 8)
  components/auto-refresh.tsx              ← promoted from components/owner/auto-refresh.tsx               (Task 9)
  app/(admin)/admin/audit/page.tsx         ← RSC fetch + 2-query merge                                     (Task 10)
  app/(admin)/admin/audit/audit-table.tsx  ← filter + load-more (client)                                  (Task 10)
  app/(admin)/admin/status/page.tsx        ← RSC probes + heartbeats                                       (Task 11)
  app/(admin)/admin/status/status-card.tsx ← one health card                                              (Task 11)
  components/app-sidebar.tsx               ← + Audit + Status nav items                                    (Task 12)
apps/kiosk/
  src/lib/sentry.ts             ← initSentry + scrubPii (kiosk copy)                                       (Task 13)
  src/main.tsx                  ← initSentry()                                                             (Task 13)
  .env.example                  ← VITE_SENTRY_DSN                                                           (Task 13)
```

---

### Task 1: Migration `0011_health_signals.sql` + types

**Files:**
- Create: `supabase/migrations/0011_health_signals.sql`
- Modify: `packages/shared/src/supabase-types.ts` (insert a `health_signals` table block)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_health_signals.sql`:

```sql
-- 0011_health_signals.sql
-- Generic health-signal registry for the /status page. Push signals (Twilio
-- webhook, cron jobs) self-report last_ok_at; pull signals (Supabase, Sentry)
-- are probed live and are NOT stored here. operator_id keeps it multi-tenant.

create table if not exists health_signals (
  operator_id uuid not null references operators(id),
  signal      text not null,
  last_ok_at  timestamptz,
  details     jsonb,
  updated_at  timestamptz not null default now(),
  primary key (operator_id, signal)
);

alter table health_signals enable row level security;

-- Admins of the operator may read their own operator's signals.
-- Writes are service-role only (webhooks + cron), which bypasses RLS, so there
-- is no insert/update policy here by design.
create policy health_signals_admin_select on health_signals
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and current_user_role() = 'ADMIN'
  );
```

- [ ] **Step 2: Add the table type to `supabase-types.ts`**

In `packages/shared/src/supabase-types.ts`, inside the `Tables: { … }` object (e.g. immediately after the `operator_settings: { … };` block), insert:

```ts
      health_signals: {
        Row: {
          operator_id: string;
          signal: string;
          last_ok_at: string | null;
          details: Json | null;
          updated_at: string;
        };
        Insert: {
          operator_id: string;
          signal: string;
          last_ok_at?: string | null;
          details?: Json | null;
          updated_at?: string;
        };
        Update: {
          operator_id?: string;
          signal?: string;
          last_ok_at?: string | null;
          details?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
```

- [ ] **Step 3: Apply the migration**

Apply `0011` to the Supabase project — `supabase db push`, the dashboard SQL editor, or the Supabase MCP `apply_migration`. This is a checkpoint: confirm it succeeds (table visible in the dashboard) before Task 8 (which writes to it at runtime).

- [ ] **Step 4: Typecheck**

Run: `pnpm -w typecheck`
Expected: PASS (the new `health_signals` type resolves; nothing references it yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_health_signals.sql packages/shared/src/supabase-types.ts
git commit -m "feat(8): migration 0011 — health_signals registry + types"
```

---

### Task 2: `lib/sentry/scrub.ts` — PII scrubber

**Files:**
- Create: `apps/portal/lib/sentry/scrub.ts`
- Test: `apps/portal/tests/sentry/scrub.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/sentry/scrub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scrubEvent, scrubPii } from "@/lib/sentry/scrub";

describe("scrubPii", () => {
  it("drops sensitive keys anywhere in the tree", () => {
    const out = scrubPii({
      extra: { caller_number: "+14155551234", recording_url: "https://x/rec.mp3", room: "204" },
    }) as { extra: Record<string, unknown> };
    expect(out.extra).not.toHaveProperty("caller_number");
    expect(out.extra).not.toHaveProperty("recording_url");
    expect(out.extra.room).toBe("204");
  });

  it("redacts phone-shaped substrings in free text", () => {
    expect(scrubPii("call from +1 (415) 555-1234 now")).toBe("call from [redacted] now");
  });

  it("preserves real UUIDs and short numbers", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(scrubPii(`ref ${uuid} room 204`)).toBe(`ref ${uuid} room 204`);
  });

  it("recurses into arrays", () => {
    expect(scrubPii(["+14155551234", "ok"])).toEqual(["[redacted]", "ok"]);
  });
});

describe("scrubEvent", () => {
  it("returns the event with breadcrumb text redacted", () => {
    const ev = scrubEvent({
      message: "boom",
      breadcrumbs: [{ message: "dialing +14155551234" }],
    });
    expect((ev.breadcrumbs?.[0] as { message: string }).message).toBe("dialing [redacted]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/sentry/scrub.test.ts`
Expected: FAIL ("Cannot find module '@/lib/sentry/scrub'").

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/sentry/scrub.ts`:

```ts
// PII scrubber for Sentry. Wired as each app's `beforeSend`. Removes the two
// known-sensitive keys anywhere in the payload and redacts phone-shaped runs
// from any free text (messages, breadcrumbs). The phone pattern requires a long
// run of digits + phone separators only, so it ignores real (hex) UUIDs and
// short numbers like room numbers.

const SENSITIVE_KEYS = new Set(["caller_number", "recording_url"]);
export const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;

export function scrubPii(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(PHONE_RE, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(scrubPii);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      out[k] = scrubPii(v);
    }
    return out;
  }
  return value;
}

// Unconstrained generic on purpose: Sentry's `Event` is an interface (no index
// signature), so a `Record<string, unknown>` constraint would reject it at the
// `beforeSend` call site. The scrub is purely structural, so `<T>(event: T): T`
// is the safe contract — it accepts any SDK's event shape and returns the same.
export function scrubEvent<T>(event: T): T {
  return scrubPii(event) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/sentry/scrub.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/sentry/scrub.ts apps/portal/tests/sentry/scrub.test.ts
git commit -m "feat(8): Sentry PII scrubber (drop keys + redact phone runs)"
```

---

### Task 3: `lib/sentry/errors.ts` — recent error count

**Files:**
- Create: `apps/portal/lib/sentry/errors.ts`
- Test: `apps/portal/tests/sentry/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/sentry/errors.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRecentErrorCount } from "@/lib/sentry/errors";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv("SENTRY_ORG", "lobby-connect");
  vi.stubEnv("SENTRY_PROJECT", "portal");
  vi.stubEnv("SENTRY_AUTH_TOKEN", "tok");
});
afterEach(() => vi.unstubAllEnvs());

describe("getRecentErrorCount", () => {
  it("returns null when config is missing", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "");
    expect(await getRecentErrorCount(fakeFetch([{}, {}]))).toBeNull();
  });

  it("returns the issue array length on success", async () => {
    expect(await getRecentErrorCount(fakeFetch([{ id: "1" }, { id: "2" }, { id: "3" }]))).toBe(3);
  });

  it("returns null on a non-ok response", async () => {
    expect(await getRecentErrorCount(fakeFetch({ detail: "no" }, false, 500))).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const throwing = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await getRecentErrorCount(throwing)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/sentry/errors.test.ts`
Expected: FAIL ("Cannot find module '@/lib/sentry/errors'").

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/sentry/errors.ts`:

```ts
import "server-only";

// Count of unresolved issues in the last 24h, from the Sentry API. Server-only
// (uses the auth token). Returns null on any missing-config / failure so the
// /status card degrades to a link instead of breaking the page. `fetchImpl` is
// injectable for tests. The count is one page of issues (Sentry caps at 100),
// which is plenty of resolution for an at-a-glance health dot.
export async function getRecentErrorCount(
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!org || !project || !token) return null;

  try {
    const query = encodeURIComponent("is:unresolved");
    const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?statsPeriod=24h&query=${query}`;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const issues: unknown = await res.json();
    return Array.isArray(issues) ? issues.length : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/sentry/errors.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/sentry/errors.ts apps/portal/tests/sentry/errors.test.ts
git commit -m "feat(8): getRecentErrorCount — Sentry issue count with null fallback"
```

---

### Task 4: `lib/health/heartbeat.ts` — recordHeartbeat

**Files:**
- Create: `apps/portal/lib/health/heartbeat.ts`
- Test: `apps/portal/tests/health/heartbeat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/health/heartbeat.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const upsertSpy = vi.fn((_v: unknown) => Promise.resolve({ error: null }));
let throwOnUpsert = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (v: unknown) => {
        if (throwOnUpsert) throw new Error("db down");
        return upsertSpy(v);
      },
    }),
  }),
}));

import { recordHeartbeat } from "@/lib/health/heartbeat";

beforeEach(() => {
  upsertSpy.mockClear();
  throwOnUpsert = false;
});

describe("recordHeartbeat", () => {
  it("upserts operator_id + signal + last_ok_at", async () => {
    await recordHeartbeat("op1", "twilio_webhook");
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.operator_id).toBe("op1");
    expect(payload.signal).toBe("twilio_webhook");
    expect(payload).toHaveProperty("last_ok_at");
  });

  it("never throws when the write fails (best-effort)", async () => {
    throwOnUpsert = true;
    await expect(recordHeartbeat("op1", "cron_mark_stale_offline")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/health/heartbeat.test.ts`
Expected: FAIL ("Cannot find module '@/lib/health/heartbeat'").

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/health/heartbeat.ts`:

```ts
import "server-only";
import type { Json } from "@lc/shared";
import { createAdminClient } from "@/lib/supabase/admin";

// Push-signal writer for the /status registry. Service-role upsert keyed on
// (operator_id, signal). Best-effort: a failure here must never break the
// caller's primary work (a Twilio webhook response, a cron sweep), so it
// swallows errors after logging.
export async function recordHeartbeat(
  operatorId: string,
  signal: string,
  details?: Json,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const admin = createAdminClient();
    await admin.from("health_signals").upsert(
      {
        operator_id: operatorId,
        signal,
        last_ok_at: now,
        details: details ?? null,
        updated_at: now,
      },
      { onConflict: "operator_id,signal" },
    );
  } catch (err) {
    console.error("[heartbeat] failed for", signal, err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/health/heartbeat.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/health/heartbeat.ts apps/portal/tests/health/heartbeat.test.ts
git commit -m "feat(8): recordHeartbeat — best-effort health_signals upsert"
```

---

### Task 5: `lib/status/signals.ts` — specs + classifiers

**Files:**
- Create: `apps/portal/lib/status/signals.ts`
- Test: `apps/portal/tests/status/signals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/status/signals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SIGNAL_SPECS,
  classifyHeartbeat,
  classifyProbe,
  classifyErrorCount,
  type SignalSpec,
} from "@/lib/status/signals";

const NOW = Date.parse("2026-06-03T12:00:00Z");
const cron = SIGNAL_SPECS.find((s) => s.signal === "cron_mark_stale_offline") as SignalSpec;
const twilio = SIGNAL_SPECS.find((s) => s.signal === "twilio_webhook") as SignalSpec;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("classifyHeartbeat", () => {
  it("unknown when never seen", () => {
    expect(classifyHeartbeat(null, NOW, cron)).toBe("unknown");
  });
  it("liveness: ok / warn / down by age", () => {
    expect(classifyHeartbeat(ago(10_000), NOW, cron)).toBe("ok");
    expect(classifyHeartbeat(ago(120_000), NOW, cron)).toBe("warn");
    expect(classifyHeartbeat(ago(600_000), NOW, cron)).toBe("down");
  });
  it("info: always ok once seen, regardless of age", () => {
    expect(classifyHeartbeat(ago(86_400_000), NOW, twilio)).toBe("ok");
  });
});

describe("classifyProbe", () => {
  it("maps boolean to ok/down", () => {
    expect(classifyProbe(true)).toBe("ok");
    expect(classifyProbe(false)).toBe("down");
  });
});

describe("classifyErrorCount", () => {
  it("null -> unknown, 0 -> ok, few -> warn, many -> down", () => {
    expect(classifyErrorCount(null)).toBe("unknown");
    expect(classifyErrorCount(0)).toBe("ok");
    expect(classifyErrorCount(3)).toBe("warn");
    expect(classifyErrorCount(50)).toBe("down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/status/signals.test.ts`
Expected: FAIL ("Cannot find module '@/lib/status/signals'").

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/status/signals.ts`:

```ts
// Pure classification for the /status page. Thresholds live here (not in the
// DB row) so they tune without a migration. Two signal kinds share the table:
//   - 'liveness': a job that should run on a cadence; stale => warn/down.
//   - 'info': a fact whose absence isn't an outage (a quiet pilot has no calls);
//             green once ever seen, grey if never.

export type SignalStatus = "ok" | "warn" | "down" | "unknown";
export type SignalMode = "liveness" | "info";

export type SignalSpec = {
  signal: string;
  label: string;
  mode: SignalMode;
  warnAfterMs?: number;
  downAfterMs?: number;
};

export const SIGNAL_SPECS: readonly SignalSpec[] = [
  { signal: "twilio_webhook", label: "Twilio webhook", mode: "info" },
  {
    signal: "cron_mark_stale_offline",
    label: "Presence sweep (cron)",
    mode: "liveness",
    warnAfterMs: 90_000, // runs every minute; > 90s is a missed beat
    downAfterMs: 300_000, // > 5 min: treat as stopped
  },
] as const;

export function classifyHeartbeat(
  lastOkAt: string | null,
  now: number,
  spec: SignalSpec,
): SignalStatus {
  if (!lastOkAt) return "unknown";
  if (spec.mode === "info") return "ok";
  const ageMs = now - new Date(lastOkAt).getTime();
  if (spec.downAfterMs !== undefined && ageMs >= spec.downAfterMs) return "down";
  if (spec.warnAfterMs !== undefined && ageMs >= spec.warnAfterMs) return "warn";
  return "ok";
}

export function classifyProbe(ok: boolean): SignalStatus {
  return ok ? "ok" : "down";
}

export function classifyErrorCount(count: number | null): SignalStatus {
  if (count === null) return "unknown";
  if (count === 0) return "ok";
  if (count < 10) return "warn";
  return "down";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/status/signals.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/status/signals.ts apps/portal/tests/status/signals.test.ts
git commit -m "feat(8): status signal specs + pure classifiers"
```

---

### Task 6: `lib/audit/query.ts` — filter + actor merge

**Files:**
- Create: `apps/portal/lib/audit/query.ts`
- Test: `apps/portal/tests/audit/query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/audit/query.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateAuditFilter,
  mergeActorNames,
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  type AuditRow,
} from "@/lib/audit/query";

describe("validateAuditFilter", () => {
  it("defaults and clamps the limit", () => {
    expect(validateAuditFilter({}).limit).toBe(AUDIT_DEFAULT_LIMIT);
    expect(validateAuditFilter({ limit: "0" }).limit).toBe(AUDIT_DEFAULT_LIMIT);
    expect(validateAuditFilter({ limit: "99999" }).limit).toBe(AUDIT_MAX_LIMIT);
    expect(validateAuditFilter({ limit: "120" }).limit).toBe(120);
  });
  it("trims action, empty -> null", () => {
    expect(validateAuditFilter({ action: "  user.invited " }).action).toBe("user.invited");
    expect(validateAuditFilter({ action: "  " }).action).toBeNull();
  });
});

describe("mergeActorNames", () => {
  const base: AuditRow = {
    id: "1",
    actor_user_id: "u1",
    actor_type: "USER",
    action: "x",
    entity_type: "y",
    entity_id: null,
    details: null,
    created_at: "2026-06-03T00:00:00Z",
  };

  it("resolves USER names, falls back to Unknown", () => {
    const out = mergeActorNames([base], [{ id: "u1", full_name: "Ada" }]);
    expect(out[0]?.actorName).toBe("Ada");
    expect(mergeActorNames([base], [])[0]?.actorName).toBe("Unknown");
  });
  it("labels SYSTEM and null actors as System", () => {
    expect(mergeActorNames([{ ...base, actor_type: "SYSTEM" }], [])[0]?.actorName).toBe("System");
    expect(mergeActorNames([{ ...base, actor_user_id: null }], [])[0]?.actorName).toBe("System");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/audit/query.test.ts`
Expected: FAIL ("Cannot find module '@/lib/audit/query'").

- [ ] **Step 3: Write the implementation**

Create `apps/portal/lib/audit/query.ts`:

```ts
// Pure helpers for the /audit viewer. The filter object carries more than the
// v1 UI exposes (date range, entity, actor) so richer filtering is a UI-only
// add later — no data-layer change. Actor names use the established 2-query
// merge (audit_logs.actor_user_id -> profiles, joined client-side).

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 500;

export type AuditFilter = {
  action: string | null;
  entityType: string | null;
  from: string | null;
  to: string | null;
  limit: number;
};

export function validateAuditFilter(params: {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: string;
}): AuditFilter {
  const limit = Math.min(
    Math.max(Number(params.limit) || AUDIT_DEFAULT_LIMIT, AUDIT_DEFAULT_LIMIT),
    AUDIT_MAX_LIMIT,
  );
  return {
    action: params.action?.trim() || null,
    entityType: params.entityType?.trim() || null,
    from: params.from?.trim() || null,
    to: params.to?.trim() || null,
    limit,
  };
}

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};

export function mergeActorNames(
  rows: AuditRow[],
  profiles: { id: string; full_name: string }[],
): (AuditRow & { actorName: string })[] {
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    ...r,
    actorName:
      r.actor_type === "SYSTEM" || !r.actor_user_id
        ? "System"
        : (nameById.get(r.actor_user_id) ?? "Unknown"),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/audit/query.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/audit/query.ts apps/portal/tests/audit/query.test.ts
git commit -m "feat(8): audit filter + actor-name merge helpers"
```

---

### Task 7: Sentry portal wiring + Vercel Analytics  ⚠️ MANUAL SETUP CHECKPOINT

> **Kumar's turn — do this before/at this task.** I'll pause here when executing.
>
> 1. In Sentry (org `lobby-connect`) → **Create project** → platform **Next.js** → name it `portal`. Copy its **DSN**.
> 2. Optionally create a second project (platform **React**) named `kiosk` for Task 13; copy that DSN too.
> 3. **Settings → Auth Tokens** (or an Internal Integration) → create a token with scopes **`project:read`** (for the `/status` count) and **`project:releases`** (for source-map upload). Copy it.
> 4. Note your **org slug** (`lobby-connect`) and **project slug** (`portal`).
> 5. Set these in `apps/portal/.env.local` (local) and in **Vercel → portal project → Settings → Environment Variables** (Production + Preview):
>    - `NEXT_PUBLIC_SENTRY_DSN` = portal DSN
>    - `SENTRY_DSN` = portal DSN (same value; server-side reads this)
>    - `SENTRY_AUTH_TOKEN` = the token (mark **sensitive**, server-only)
>    - `SENTRY_ORG` = `lobby-connect`
>    - `SENTRY_PROJECT` = `portal`
>
> If env vars aren't set yet, the SDK no-ops and `/status` shows the Sentry card as "unknown / View in Sentry" — the build still works, so this task can land before the values exist.

**Files:**
- Create: `apps/portal/sentry.server.config.ts`, `apps/portal/sentry.edge.config.ts`, `apps/portal/instrumentation.ts`, `apps/portal/instrumentation-client.ts`
- Modify: `apps/portal/next.config.ts`, `apps/portal/app/layout.tsx`, `apps/portal/.env.example`, `apps/portal/package.json` (deps)

- [ ] **Step 1: Install deps**

Run (from repo root):
```bash
pnpm --filter @lc/portal add @sentry/nextjs @vercel/analytics
```

- [ ] **Step 2: Server + edge Sentry configs**

Create `apps/portal/sentry.server.config.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});
```

Create `apps/portal/sentry.edge.config.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});
```

- [ ] **Step 3: Instrumentation entry points**

Create `apps/portal/instrumentation.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

Create `apps/portal/instrumentation-client.ts`:

```ts
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

- [ ] **Step 4: Wrap `next.config.ts`**

In `apps/portal/next.config.ts`, wrap the existing exported config. Keep whatever config object is already there as `nextConfig`, then:

```ts
import { withSentryConfig } from "@sentry/nextjs";

// ...existing `const nextConfig = { ... }` stays unchanged...

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Source maps upload only runs when org/project/authToken are present;
  // missing values make this a no-op so local builds don't fail.
});
```

If `next.config.ts` currently does `export default nextConfig;`, replace that line with the `withSentryConfig(...)` export above.

- [ ] **Step 5: Add `<Analytics />` to the root layout**

In `apps/portal/app/layout.tsx`, add the import and render it in `<body>` next to `<Toaster />`:

```ts
import { Analytics } from "@vercel/analytics/next";
```

```tsx
      <body>
        {children}
        <Toaster />
        <Analytics />
      </body>
```

- [ ] **Step 6: Document env in `.env.example`**

Append to `apps/portal/.env.example`:

```
# --- Sentry (optional; SDK no-ops if DSN is unset) ---
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
# Server/build only — never expose. project:read + project:releases scopes.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=lobby-connect
SENTRY_PROJECT=portal
```

- [ ] **Step 7: Typecheck + build smoke**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS.
Run: `pnpm --filter @lc/portal build`
Expected: build succeeds (Sentry plugin logs "no auth token, skipping source maps" if env is unset — not an error).

- [ ] **Step 8: Commit**

```bash
git add apps/portal/sentry.server.config.ts apps/portal/sentry.edge.config.ts \
  apps/portal/instrumentation.ts apps/portal/instrumentation-client.ts \
  apps/portal/next.config.ts apps/portal/app/layout.tsx apps/portal/.env.example \
  apps/portal/package.json pnpm-lock.yaml
git commit -m "feat(8): wire Sentry (portal) + Vercel Analytics, scrubbed beforeSend"
```

---

### Task 8: Wire heartbeats into Twilio incoming + cron

**Files:**
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts`
- Modify: `apps/portal/app/api/cron/mark-stale-offline/route.ts`
- Test: `apps/portal/tests/app/cron/heartbeat.test.ts`

- [ ] **Step 1: Write the failing test (cron heartbeat)**

Create `apps/portal/tests/app/cron/heartbeat.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const upsertSpy = vi.fn((_v: unknown) => Promise.resolve({ error: null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { update: () => ({ lt: () => ({ neq: () => Promise.resolve({ error: null }) }) }) };
      }
      if (table === "operators") {
        return { select: () => Promise.resolve({ data: [{ id: "op1" }], error: null }) };
      }
      if (table === "health_signals") {
        return { upsert: (v: unknown) => upsertSpy(v) };
      }
      return {};
    },
  }),
}));

import { GET } from "@/app/api/cron/mark-stale-offline/route";

beforeEach(() => upsertSpy.mockClear());

describe("cron mark-stale-offline heartbeat", () => {
  it("records a cron heartbeat per operator after the sweep", async () => {
    delete process.env.CRON_SECRET; // no auth gate in test
    const res = await GET(new Request("http://localhost:3000/api/cron/mark-stale-offline"));
    expect(res.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const payload = upsertSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.operator_id).toBe("op1");
    expect(payload.signal).toBe("cron_mark_stale_offline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/app/cron/heartbeat.test.ts`
Expected: FAIL (upsert never called — the cron doesn't write a heartbeat yet).

- [ ] **Step 3: Add the cron heartbeat**

In `apps/portal/app/api/cron/mark-stale-offline/route.ts`, add the import and append the heartbeat loop after the existing OFFLINE update, before the final `return`:

```ts
import { recordHeartbeat } from "@/lib/health/heartbeat";
```

```ts
  // Self-report cron liveness for /status (per operator — multi-tenant-safe).
  const { data: operators } = await admin.from("operators").select("id");
  for (const op of operators ?? []) {
    await recordHeartbeat(op.id, "cron_mark_stale_offline");
  }

  return NextResponse.json({ ok: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/app/cron/heartbeat.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Twilio webhook heartbeat**

In `apps/portal/app/api/twilio/voice/incoming/route.ts`, add the import and a best-effort heartbeat right after the property is confirmed active (just after the `if (!property || !property.active) { … }` block, where `property.operator_id` is known):

```ts
import { recordHeartbeat } from "@/lib/health/heartbeat";
```

```ts
    // Best-effort: record that Twilio reached us (off the critical path).
    await recordHeartbeat(property.operator_id, "twilio_webhook");
```

(`recordHeartbeat` already swallows its own errors, so the dial flow is unaffected if the write fails.)

- [ ] **Step 6: Typecheck + full test**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS.
Run: `pnpm test`
Expected: PASS (new heartbeat test green; existing voice tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/app/api/twilio/voice/incoming/route.ts \
  apps/portal/app/api/cron/mark-stale-offline/route.ts \
  apps/portal/tests/app/cron/heartbeat.test.ts
git commit -m "feat(8): self-report twilio_webhook + cron heartbeats to /status registry"
```

---

### Task 9: Promote `<AutoRefresh>` to a shared location

**Files:**
- Create: `apps/portal/components/auto-refresh.tsx`
- Delete: `apps/portal/components/owner/auto-refresh.tsx`
- Modify: every importer of the old path

- [ ] **Step 1: Move the file**

Create `apps/portal/components/auto-refresh.tsx` with the exact contents of `apps/portal/components/owner/auto-refresh.tsx` (unchanged):

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

Then delete `apps/portal/components/owner/auto-refresh.tsx`.

- [ ] **Step 2: Update all importers**

Run to find them:
```bash
grep -rl "components/owner/auto-refresh" apps/portal/app apps/portal/components
```
In each match, change the import path from `@/components/owner/auto-refresh` to `@/components/auto-refresh`. (Owner pages: home, calls, property detail, incidents — wherever `<AutoRefresh>` is used.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS (no dangling import of the old path).

- [ ] **Step 4: Commit**

```bash
git add -A apps/portal/components apps/portal/app
git commit -m "refactor(8): promote AutoRefresh to components/ (shared by admin + owner)"
```

---

### Task 10: `/admin/audit` page + table

**Files:**
- Create: `apps/portal/app/(admin)/admin/audit/page.tsx`
- Create: `apps/portal/app/(admin)/admin/audit/audit-table.tsx`

- [ ] **Step 1: Build the client table**

Create `apps/portal/app/(admin)/admin/audit/audit-table.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AuditTableRow = {
  id: string;
  actorName: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: unknown;
  created_at: string;
};

export function AuditTable({
  rows,
  actions,
  activeAction,
  limit,
  hasMore,
}: {
  readonly rows: AuditTableRow[];
  readonly actions: string[];
  readonly activeAction: string | null;
  readonly limit: number;
  readonly hasMore: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setAction(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value === "all") sp.delete("action");
    else sp.set("action", value);
    sp.delete("limit");
    router.push(`/admin/audit?${sp.toString()}`);
  }

  function loadMore() {
    const sp = new URLSearchParams(params.toString());
    sp.set("limit", String(limit + 50));
    router.push(`/admin/audit?${sp.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Action</span>
        <Select value={activeAction ?? "all"} onValueChange={setAction}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border py-16 text-center text-sm text-text-muted">
          No audit events.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell
                  className="whitespace-nowrap text-text-muted"
                  title={new Date(r.created_at).toLocaleString()}
                >
                  {new Date(r.created_at).toLocaleString()}
                </TableCell>
                <TableCell>{r.actorName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.action}</Badge>
                </TableCell>
                <TableCell className="text-text-muted">
                  {r.entity_type}
                  {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ""}
                </TableCell>
                <TableCell>
                  {r.details ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-primary">
                        view
                      </summary>
                      <pre className="mt-1 max-w-md overflow-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {hasMore && (
        <button
          onClick={loadMore}
          className="self-center text-sm text-primary hover:underline"
        >
          Load more
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the RSC page**

Create `apps/portal/app/(admin)/admin/audit/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import {
  validateAuditFilter,
  mergeActorNames,
  type AuditRow,
} from "@/lib/audit/query";
import { AuditTable } from "./audit-table";

// Curated catalog of audit actions written across the app, for the filter
// dropdown. (A distinct-on-action query is the v1.1 upgrade; this list avoids a
// second round-trip and keeps the order meaningful.)
const KNOWN_ACTIONS = [
  "user.signed_in",
  "user.signed_out",
  "user.invited",
  "user.updated",
  "user.deactivated",
  "user.deleted",
  "property.created",
  "property.updated",
  "property.kiosk_edited",
  "property.playbook_uploaded",
  "assignment.changed",
  "incident.resolved",
];

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requireRole("ADMIN");
  const filter = validateAuditFilter(sp);
  const supabase = await createServerClient();

  let q = supabase
    .from("audit_logs")
    .select(
      "id, actor_user_id, actor_type, action, entity_type, entity_id, details, created_at",
    )
    .eq("operator_id", actor.operator_id)
    .order("created_at", { ascending: false })
    .limit(filter.limit);

  if (filter.action) q = q.eq("action", filter.action);
  if (filter.entityType) q = q.eq("entity_type", filter.entityType);
  if (filter.from) q = q.gte("created_at", filter.from);
  if (filter.to) q = q.lte("created_at", filter.to);

  const { data } = await q;
  const rows = (data ?? []) as AuditRow[];

  const actorIds = [
    ...new Set(rows.map((r) => r.actor_user_id).filter((x): x is string => !!x)),
  ];
  let profiles: { id: string; full_name: string }[] = [];
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    profiles = profs ?? [];
  }

  const merged = mergeActorNames(rows, profiles);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-foreground">Audit log</h1>
      <AuditTable
        rows={merged}
        actions={KNOWN_ACTIONS}
        activeAction={filter.action}
        limit={filter.limit}
        hasMore={rows.length === filter.limit}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/audit
git commit -m "feat(8): /admin/audit — audit log viewer (filter + load-more)"
```

---

### Task 11: `/admin/status` page + card

**Files:**
- Create: `apps/portal/app/(admin)/admin/status/status-card.tsx`
- Create: `apps/portal/app/(admin)/admin/status/page.tsx`

- [ ] **Step 1: Build the status card**

Create `apps/portal/app/(admin)/admin/status/status-card.tsx`:

```tsx
import type { SignalStatus } from "@/lib/status/signals";

const DOT: Record<SignalStatus, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  down: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

export function StatusCard({
  label,
  status,
  value,
  href,
}: {
  readonly label: string;
  readonly status: SignalStatus;
  readonly value: string;
  readonly href?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[status]}`}
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <span className="text-sm text-text-muted">{value}</span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary hover:underline"
        >
          View in Sentry
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the RSC page**

Create `apps/portal/app/(admin)/admin/status/page.tsx`:

```tsx
import { requireRole } from "@/lib/auth/require-role";
import { createServerClient } from "@/lib/supabase/server";
import { getRecentErrorCount } from "@/lib/sentry/errors";
import {
  SIGNAL_SPECS,
  classifyHeartbeat,
  classifyProbe,
  classifyErrorCount,
} from "@/lib/status/signals";
import { AutoRefresh } from "@/components/auto-refresh";
import { StatusCard } from "./status-card";

function relative(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export default async function AdminStatusPage() {
  const actor = await requireRole("ADMIN");
  const supabase = await createServerClient();

  // Pull signal 1: Supabase round-trip.
  let supabaseOk = true;
  try {
    const { error } = await supabase
      .from("health_signals")
      .select("signal")
      .limit(1);
    supabaseOk = !error;
  } catch {
    supabaseOk = false;
  }

  // Pull signal 2: Sentry issue count (null => degrade to link-only).
  const errorCount = await getRecentErrorCount();
  const sentryUrl =
    process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
      ? `https://sentry.io/organizations/${process.env.SENTRY_ORG}/projects/${process.env.SENTRY_PROJECT}/`
      : "https://sentry.io/";

  // Push signals: heartbeat registry for this operator.
  const { data: signals } = await supabase
    .from("health_signals")
    .select("signal, last_ok_at")
    .eq("operator_id", actor.operator_id);
  const lastBySignal = new Map(
    (signals ?? []).map((s) => [s.signal, s.last_ok_at]),
  );
  const now = Date.now();

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4 p-6">
      <AutoRefresh />
      <h1 className="text-2xl font-semibold text-foreground">Status</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatusCard
          label="Supabase"
          status={classifyProbe(supabaseOk)}
          value={supabaseOk ? "Reachable" : "Unreachable"}
        />
        <StatusCard
          label="Recent errors (24h)"
          status={classifyErrorCount(errorCount)}
          value={
            errorCount === null
              ? "Sentry unavailable"
              : `${errorCount} unresolved`
          }
          href={sentryUrl}
        />
        {SIGNAL_SPECS.map((spec) => {
          const last = lastBySignal.get(spec.signal) ?? null;
          return (
            <StatusCard
              key={spec.signal}
              label={spec.label}
              status={classifyHeartbeat(last, now, spec)}
              value={`Last: ${relative(last)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/\(admin\)/admin/status
git commit -m "feat(8): /admin/status — health cards (registry + Supabase + Sentry probes)"
```

---

### Task 12: Sidebar nav items

**Files:**
- Modify: `apps/portal/components/app-sidebar.tsx`

- [ ] **Step 1: Add the nav items**

In `apps/portal/components/app-sidebar.tsx`, extend the lucide import and `NAV_ITEMS`:

```ts
import { Activity, Building2, ScrollText, Settings, Users, UsersRound } from "lucide-react";
```

```ts
const NAV_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/properties", label: "Properties", icon: Building2 },
  { href: "/admin/assignments", label: "Assignments", icon: UsersRound },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/status", label: "Status", icon: Activity },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS (both routes now exist from Tasks 10–11, so typed routes resolve).

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/app-sidebar.tsx
git commit -m "feat(8): admin sidebar — Audit log + Status nav items"
```

---

### Task 13: Sentry in the kiosk

**Files:**
- Create: `apps/kiosk/src/lib/sentry.ts`
- Modify: `apps/kiosk/src/main.tsx`, `apps/kiosk/.env.example`, `apps/kiosk/package.json` (deps)

- [ ] **Step 1: Install the SDK**

Run (from repo root):
```bash
pnpm --filter @lc/kiosk add @sentry/react
```

- [ ] **Step 2: Kiosk Sentry init + scrubber**

Create `apps/kiosk/src/lib/sentry.ts` (the kiosk is a separate Vite package and can't import portal `@/` code, so the scrubber is a small local copy — keep it in sync with `apps/portal/lib/sentry/scrub.ts`):

```ts
import * as Sentry from "@sentry/react";

const SENSITIVE_KEYS = new Set(["caller_number", "recording_url"]);
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;

function scrubPii(value: unknown): unknown {
  if (typeof value === "string") return value.replace(PHONE_RE, "[redacted]");
  if (Array.isArray(value)) return value.map(scrubPii);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      out[k] = scrubPii(v);
    }
    return out;
  }
  return value;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return; // no-op when unconfigured
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubPii(event) as typeof event,
  });
}
```

- [ ] **Step 3: Call it at boot**

In `apps/kiosk/src/main.tsx`, import and invoke before the React render:

```ts
import { initSentry } from "./lib/sentry";

initSentry();
```

(Place `initSentry();` immediately after the imports, before `createRoot(...)`.)

- [ ] **Step 4: Document env**

Append to `apps/kiosk/.env.example`:

```
# Sentry (optional; SDK no-ops if unset). Public client DSN — safe in the bundle.
VITE_SENTRY_DSN=
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @lc/kiosk typecheck && pnpm --filter @lc/kiosk build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/lib/sentry.ts apps/kiosk/src/main.tsx apps/kiosk/.env.example \
  apps/kiosk/package.json pnpm-lock.yaml
git commit -m "feat(8): wire Sentry in the kiosk (scrubbed beforeSend)"
```

---

### Task 14: Full verification + smoke + tag

**Files:** none (verification only)

- [ ] **Step 1: Monorepo gates**

Run (repo root): `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
Expected: all PASS (new suites: scrub, errors, heartbeat, signals, audit query, cron heartbeat).

- [ ] **Step 2: Manual smoke — Sentry**

With Sentry env set, trigger a deliberate error in the portal (e.g. a throwaway route or a thrown error in a Server Component) and one in the kiosk. Confirm both appear in the Sentry `portal`/`kiosk` projects, and that the event payload contains **no** phone number or recording URL (check `extra`/breadcrumbs).

- [ ] **Step 3: Manual smoke — /audit**

Sign in as an admin → `/admin/audit`. Confirm recent events list with actor names; the action filter narrows; "Load more" grows the list. Sign in as a non-admin (agent/owner) and confirm `/admin/audit` redirects.

- [ ] **Step 4: Manual smoke — /status**

`/admin/status`: Supabase card green; Recent-errors card shows a count + "View in Sentry" (temporarily blank `SENTRY_AUTH_TOKEN` → card flips to "Sentry unavailable" + link, page still renders). Place a test inbound call → the Twilio webhook card flips to "just now" within a refresh tick. The presence-sweep card is green; it goes amber/red only if the cron stops (it runs every minute).

- [ ] **Step 5: Update build status + tag**

Update `CLAUDE.md` (build-status table: mark Plan 8 complete) and `memory/project-status.md` (last completed plan = 8). Commit, then tag:

```bash
git commit -am "docs(8): mark observability complete"
git tag plan-08-observability-complete
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Sentry both apps (Tasks 7, 13) + PII scrub (Task 2) ✓; Vercel Analytics (Task 7) ✓; `/audit` viewer + filter-object + 2-query merge (Tasks 6, 10) ✓; `health_signals` registry + RLS (Task 1) ✓; heartbeat writers Twilio + cron (Task 8) ✓; `/status` pull probes (Supabase, Sentry count + fallback) + push cards (Task 11) ✓; admin-only via `requireRole("ADMIN")` (Tasks 10, 11) ✓; nav (Task 12) ✓; AutoRefresh reuse (Task 9) ✓. **Refinement vs spec:** the spec mentioned keyset pagination; the plan uses the codebase's established limit-growth "Load more" (owner/calls) for consistency — same UX, simpler, fine for pilot-scale audit volume.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `SignalStatus`/`SignalSpec` (Task 5) consumed unchanged in Tasks 11; `AuditRow`/`AuditFilter` (Task 6) consumed in Task 10; `recordHeartbeat(operatorId, signal, details?)` (Task 4) called identically in Task 8; `scrubEvent` (Task 2) imported by Tasks 7 and (as a copy) 13.
```
