# Phase 4 — Invariants, Indexes & CI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the remaining 2026-06-10 audit invariants in one place each, add two missing DB indexes, remove dead code, and stand up GitHub Actions CI so none of it can silently regress.

**Architecture:** Two new single-sources land in `@lc/shared` — `protocol.ts` (all cross-app timing constants) and `database.generated.ts` (machine-generated DB structure, re-narrowed by the curated `supabase-types.ts` overlay). Everything else is behavior-preserving cleanup except three tested fixes (S3 presence staleness bound, S8 kiosk one-active DB guard, S2 dial-cap). CI is the enforcement layer that runs every check on every PR.

**Tech Stack:** pnpm 9.15.9 workspace, Node 22, Next.js 15 (App Router, `typedRoutes`), Vite (kiosk), Supabase (Postgres + CLI), Vitest, `type-fest` (MergeDeep), GitHub Actions.

**Spec:** `docs/specs/2026-06-14-phase4-invariants-ci-design.md`

**Conventions:** commits prefixed `feat(phase4):` / `refactor(phase4):` / `test(phase4):` / `chore(phase4):`. Run commands from the repo root. Portal tests: `pnpm --filter @lc/portal test`. Shared tests: `pnpm --filter @lc/shared test`. Full gate: `pnpm typecheck && pnpm lint && pnpm test`.

---

## Task 1: Shared timing constants — `protocol.ts` (M7, A8)

Single home for the ring window, presence staleness, reaper cutoffs, and cron cadence. Replaces five scattered declarations across both apps.

**Files:**
- Create: `packages/shared/src/protocol.ts`
- Create: `packages/shared/tests/protocol.test.ts`
- Modify: `packages/shared/src/index.ts` (add barrel export)
- Modify: `apps/portal/lib/voice/presence.ts` (drop `STALE_AFTER_MS`, import from shared)
- Modify: `apps/portal/lib/calls/reaper.ts` (drop `REAP_*` literals, re-export from shared)
- Modify: `apps/portal/lib/status/signals.ts` (import `CRON_SWEEP_INTERVAL_MS`)
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts` (`RING_TIMEOUT_SECONDS` → `RING_WINDOW_SECONDS`)
- Modify: `apps/portal/app/api/cron/mark-stale-offline/route.ts` (`STALE_AFTER_MS` → `PRESENCE_STALE_AFTER_MS`)
- Modify: `apps/kiosk/src/App.tsx` (`RING_TIMEOUT_MS` → `RING_WINDOW_MS`)

- [ ] **Step 1: Write the failing test**

`packages/shared/tests/protocol.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  RING_WINDOW_SECONDS,
  RING_WINDOW_MS,
  PRESENCE_STALE_AFTER_MS,
  REAP_RINGING_AFTER_MS,
  REAP_IN_PROGRESS_AFTER_MS,
  CRON_SWEEP_INTERVAL_MS,
} from "../src/protocol";

describe("protocol timing invariants", () => {
  it("reaper ringing cutoff outlasts the ring window", () => {
    expect(REAP_RINGING_AFTER_MS).toBeGreaterThan(RING_WINDOW_MS);
  });

  it("pins the documented values (no accidental drift)", () => {
    expect(RING_WINDOW_SECONDS).toBe(120);
    expect(RING_WINDOW_MS).toBe(120_000);
    expect(PRESENCE_STALE_AFTER_MS).toBe(90_000);
    expect(REAP_RINGING_AFTER_MS).toBe(600_000);
    expect(REAP_IN_PROGRESS_AFTER_MS).toBe(1_800_000);
    expect(CRON_SWEEP_INTERVAL_MS).toBe(86_400_000);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @lc/shared test`
Expected: FAIL — cannot resolve `../src/protocol`.

- [ ] **Step 3: Create `packages/shared/src/protocol.ts`**

```ts
// Single home for cross-app timing invariants. Imported by both portal and
// kiosk via @lc/shared so the ring window, reaper cutoffs, presence staleness,
// and cron cadence each have exactly one definition.

/** Guest-dial ring window (locked decision 1). Mirrored in the Twilio webhook + kiosk. */
export const RING_WINDOW_SECONDS = 120;
export const RING_WINDOW_MS = RING_WINDOW_SECONDS * 1000;

/** A browser heartbeat older than this is stale: swept OFFLINE by cron, OFFLINE at read. */
export const PRESENCE_STALE_AFTER_MS = 90_000;

/** A connected (answered) video call alive longer than this is treated as dead (reaper). */
export const REAP_IN_PROGRESS_AFTER_MS = 30 * 60_000;
/** A ringing video call older than this is treated as a dead kiosk (reaper). */
export const REAP_RINGING_AFTER_MS = 10 * 60_000;

/**
 * Presence-sweep cron cadence. PILOT (Vercel Hobby caps crons at once/day) = daily.
 * BEFORE PUBLIC LAUNCH: move to Vercel Pro, set apps/portal/vercel.json's cron
 * schedule back to "* * * * *", and change this to 60_000. The /status thresholds
 * derive from it, so this constant is the entire switch.
 */
export const CRON_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The reaper must outlast the ring window, or a still-ringing call could be reaped
// mid-window. TypeScript can't compare number *values* at the type level, so guard
// at module load; protocol.test.ts pins the same invariant.
if (REAP_RINGING_AFTER_MS <= RING_WINDOW_MS) {
  throw new Error("protocol: REAP_RINGING_AFTER_MS must exceed RING_WINDOW_MS");
}
```

- [ ] **Step 4: Add the barrel export**

`packages/shared/src/index.ts` — add after the existing exports:
```ts
export * from "./protocol";
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter @lc/shared test`
Expected: PASS.

- [ ] **Step 6: Update portal consumers**

`apps/portal/lib/voice/presence.ts` — remove `export const STALE_AFTER_MS = 90_000;` and its doc comment; add at top `import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";`; in `isStale`, change `return now - seen > STALE_AFTER_MS;` to `return now - seen > PRESENCE_STALE_AFTER_MS;`.

`apps/portal/app/api/cron/mark-stale-offline/route.ts` — change `import { STALE_AFTER_MS } from "@/lib/voice/presence";` to `import { PRESENCE_STALE_AFTER_MS } from "@lc/shared";`, and `new Date(Date.now() - STALE_AFTER_MS)` → `new Date(Date.now() - PRESENCE_STALE_AFTER_MS)`.

`apps/portal/lib/calls/reaper.ts` — remove the two `export const REAP_IN_PROGRESS_AFTER_MS = …` / `REAP_RINGING_AFTER_MS = …` lines; add at top:
```ts
import { REAP_IN_PROGRESS_AFTER_MS, REAP_RINGING_AFTER_MS } from "@lc/shared";
export { REAP_IN_PROGRESS_AFTER_MS, REAP_RINGING_AFTER_MS };
```
(The re-export keeps `incoming-video/route.ts`'s `import { REAP_RINGING_AFTER_MS } from "@/lib/calls/reaper"` working unchanged.)

`apps/portal/lib/status/signals.ts` — remove `const CRON_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; …`; add `import { CRON_SWEEP_INTERVAL_MS } from "@lc/shared";` at top. Leave the two usages (`* 1.5`, `* 3`) as-is; keep a one-line comment pointing at protocol.ts for the Pro-tier flip.

`apps/portal/app/api/twilio/voice/incoming/route.ts` — remove `const RING_TIMEOUT_SECONDS = 120;`; add `RING_WINDOW_SECONDS` to the existing `@lc/shared`-adjacent imports (add `import { RING_WINDOW_SECONDS } from "@lc/shared";`); change `timeoutSeconds: RING_TIMEOUT_SECONDS,` → `timeoutSeconds: RING_WINDOW_SECONDS,`.

- [ ] **Step 7: Update kiosk consumer**

`apps/kiosk/src/App.tsx` — add `import { RING_WINDOW_MS } from "@lc/shared";` to the import block; remove `const RING_TIMEOUT_MS = 120_000;`; change the `setTimeout(…, RING_TIMEOUT_MS)` call to `…, RING_WINDOW_MS)`.

- [ ] **Step 8: Grep for stragglers**

Run: `grep -rn "STALE_AFTER_MS\|RING_TIMEOUT\|CRON_SWEEP_INTERVAL_MS" apps/portal apps/kiosk --include=*.ts --include=*.tsx`
Expected: only the new `PRESENCE_STALE_AFTER_MS` / `RING_WINDOW_*` / `CRON_SWEEP_INTERVAL_MS` references (all sourced from `@lc/shared`). Fix any remaining old-name importer (e.g. a test or `lib/dashboard/presence.ts`) to import from `@lc/shared`.

- [ ] **Step 9: Verify**

Run: `pnpm typecheck && pnpm --filter @lc/shared test`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared apps/portal apps/kiosk
git commit -m "refactor(phase4): centralize timing invariants in @lc/shared/protocol (M7, A8)"
```

---

## Task 2: Single `CallState` source (M3)

**Files:**
- Modify: `apps/portal/lib/voice/result.ts` (re-export `CallState`, drop the duplicate union)
- Modify: `apps/portal/app/api/twilio/voice/status/route.ts` (drop `as CallState`)
- Modify: `apps/portal/app/api/twilio/voice/dial-result/route.ts` (drop `as CallState`)

- [ ] **Step 1: Re-export instead of redefining**

`apps/portal/lib/voice/result.ts` — replace the local union:
```ts
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";
```
with:
```ts
export type { CallState } from "@lc/shared";
import type { CallState } from "@lc/shared";
```
(The `import type` line is needed because `TERMINAL`, `isTerminalState`, `resolveDialResult`, and `mapFinalCallState` below reference `CallState` in value/type positions within this file.)

- [ ] **Step 2: Remove the now-unnecessary casts**

`apps/portal/app/api/twilio/voice/status/route.ts:42` — `isTerminalState(existing.state as CallState)` → `isTerminalState(existing.state)` (the `calls.state` column is already typed `CallState` via the curated types).

`apps/portal/app/api/twilio/voice/dial-result/route.ts:67` — same change: drop `as CallState`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS (if either `state` field resolves as `string` rather than `CallState`, that means the curated types aren't applied there — keep the cast at that one site and add `// reason` rather than forcing it; this should not happen).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/lib/voice/result.ts apps/portal/app/api/twilio/voice/status/route.ts apps/portal/app/api/twilio/voice/dial-result/route.ts
git commit -m "refactor(phase4): single CallState source in @lc/shared (M3)"
```

---

## Task 3: Type `AuditEvent.details` (M8)

**Files:**
- Modify: `apps/portal/lib/auth/audit.ts` (add `AuditDetails`, retype `details`)
- Modify: `apps/portal/app/(owner)/owner/properties/[id]/actions.ts:87`
- Modify: `apps/portal/app/(owner)/owner/incidents/[id]/actions.ts:52`
- Modify: `apps/portal/app/(admin)/admin/properties/actions.ts:326`
- Modify: `apps/portal/app/(admin)/admin/users/actions.ts:196`

- [ ] **Step 1: Add the type**

`apps/portal/lib/auth/audit.ts` — add after the imports:
```ts
/** Audit detail payloads are always a JSON object (never a bare scalar/array). */
export type AuditDetails = { [key: string]: Json };
```
Change `details?: Json;` in `AuditEvent` to `details?: AuditDetails;`. Change the insert line `details: event.details ?? null,` — no change needed (an object is valid `Json` for the column).

- [ ] **Step 2: Remove the divergent casts**

At each site, the value passed is already a plain object — drop the cast:
- `owner/properties/[id]/actions.ts:87` — `details: a as unknown as Json` → `details: a` (ensure `a` is typed as `AuditDetails`/`Record<string, Json>`; if `a` is built locally, annotate it `const a: AuditDetails = …`).
- `owner/incidents/[id]/actions.ts:52` — `details: { note_present: Boolean(...) } as Json` → `details: { note_present: Boolean(...) }`.
- `admin/properties/actions.ts:326` — `details: evt.details as Json` → `details: evt.details` (ensure the producing type is `AuditDetails`).
- `admin/users/actions.ts:196` — `details: evt.details as never` → `details: evt.details`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS. If a site's local object isn't assignable, annotate that object as `AuditDetails` at its construction (do NOT re-add a cast).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/lib/auth/audit.ts "apps/portal/app/(owner)" "apps/portal/app/(admin)"
git commit -m "refactor(phase4): type AuditEvent.details, remove divergent casts (M8)"
```

---

## Task 4: Audit-action constants (D10)

Single source for the audit-action vocabulary; the `/admin/audit` dropdown derives from it instead of a hand-synced literal list.

**Files:**
- Create: `apps/portal/lib/audit/actions.ts`
- Create: `apps/portal/tests/lib/audit/actions.test.ts`
- Modify: `apps/portal/app/(admin)/admin/audit/page.tsx` (import `KNOWN_ACTIONS`)
- Modify: call sites listed below (use constants instead of string literals)

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/lib/audit/actions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { AUDIT_ACTIONS, KNOWN_ACTIONS } from "@/lib/audit/actions";

describe("audit action vocabulary", () => {
  it("KNOWN_ACTIONS is derived from AUDIT_ACTIONS (no hand-sync)", () => {
    expect(KNOWN_ACTIONS).toEqual(Object.values(AUDIT_ACTIONS));
  });
  it("includes the load-bearing actions", () => {
    expect(KNOWN_ACTIONS).toContain("trigger_emergency");
    expect(KNOWN_ACTIONS).toContain("user.created");
    expect(KNOWN_ACTIONS).toContain("property.playbook_uploaded");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @lc/portal test actions`
Expected: FAIL — cannot resolve `@/lib/audit/actions`.

- [ ] **Step 3: Create the module**

`apps/portal/lib/audit/actions.ts`:
```ts
// Single source for the audit-log action vocabulary. The /admin/audit filter
// dropdown derives KNOWN_ACTIONS from this map, so it can never drift from the
// strings written at call sites.
export const AUDIT_ACTIONS = {
  USER_SIGNED_IN: "user.signed_in",
  USER_SIGNED_OUT: "user.signed_out",
  USER_CREATED: "user.created",
  USER_INVITED: "user.invited",
  USER_ONBOARDED: "user.onboarded",
  USER_PASSWORD_RESET: "user.password_reset",
  USER_PASSWORD_RESET_BY_ADMIN: "user.password_reset_by_admin",
  USER_PROFILE_EDITED: "user.profile_edited",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_ACTIVE_TOGGLED: "user.active_toggled",
  USER_DELETED: "user.deleted",
  PROPERTY_CREATED: "property.created",
  PROPERTY_EDITED: "property.edited",
  PROPERTY_ACTIVE_TOGGLED: "property.active_toggled",
  PROPERTY_KIOSK_EDITED: "property.kiosk_edited",
  PROPERTY_KIOSK_LINK_GENERATED: "property.kiosk_link_generated",
  PROPERTY_PLAYBOOK_UPLOADED: "property.playbook_uploaded",
  ASSIGNMENT_CREATED: "assignment.created",
  ASSIGNMENT_CHANGED: "assignment.changed",
  ASSIGNMENT_REMOVED: "assignment.removed",
  INCIDENT_RESOLVED: "incident.resolved",
  TRIGGER_EMERGENCY: "trigger_emergency",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Ordered list for the /admin/audit filter dropdown — derived, never hand-synced. */
export const KNOWN_ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @lc/portal test actions`
Expected: PASS.

- [ ] **Step 5: Wire the dropdown**

`apps/portal/app/(admin)/admin/audit/page.tsx` — delete the local `const KNOWN_ACTIONS = [ … ];` block (lines ~14–37); add `import { KNOWN_ACTIONS } from "@/lib/audit/actions";`. The `actions={KNOWN_ACTIONS}` prop usage is unchanged.

- [ ] **Step 6: Migrate the call sites to constants**

Replace the bare action string at each site with `AUDIT_ACTIONS.<KEY>` (add `import { AUDIT_ACTIONS } from "@/lib/audit/actions";` to each file). Sites:
- `lib/auth/audit.ts` — `"user.signed_in"` → `AUDIT_ACTIONS.USER_SIGNED_IN`; `"user.signed_out"` → `AUDIT_ACTIONS.USER_SIGNED_OUT`.
- `app/(admin)/admin/users/actions.ts` — `user.created`, `user.profile_edited`, `user.role_changed`, `user.active_toggled`, `user.deleted`, `user.password_reset_by_admin`.
- `app/(auth)/onboarding/actions.ts` — `user.onboarded`.
- `app/auth/update-password/actions.ts` — `user.password_reset`.
- `app/(admin)/admin/properties/actions.ts` — `property.created`, `property.edited`, `property.active_toggled`, `property.kiosk_link_generated`, `assignment.removed` (and `assignment.created`/`assignment.changed` if present in the assignment flow).
- `app/(owner)/owner/properties/[id]/actions.ts` — `property.kiosk_edited`.
- `app/api/owner/properties/[id]/playbook/route.ts` — `property.playbook_uploaded`.
- `app/(owner)/owner/incidents/[id]/actions.ts` — `incident.resolved`.
- `app/api/calls/[id]/emergency/route.ts` — `trigger_emergency`. **⚠️ This file is on the 911 path — change only the `action:` string literal to the constant; touch nothing else.**

- [ ] **Step 7: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal test`
Expected: PASS. Confirm no stray bare action strings remain: `grep -rn '"user\.\|"property\.\|"assignment\.\|"incident\.\|"trigger_emergency"' apps/portal/app apps/portal/lib --include=*.ts | grep -v "lib/audit/actions.ts"` should be empty (or only legitimate non-audit usages).

- [ ] **Step 8: Commit**

```bash
git add apps/portal/lib/audit apps/portal/tests/lib/audit "apps/portal/app"
git commit -m "refactor(phase4): single audit-action vocabulary in lib/audit/actions (D10)"
```

---

## Task 5: Shared playbook signed-URL helper (D9)

**Files:**
- Create: `apps/portal/lib/storage/playbook.ts`
- Create: `apps/portal/tests/lib/storage/playbook.test.ts`
- Modify: `apps/portal/app/api/calls/[id]/playbook/route.ts`
- Modify: `apps/portal/app/api/owner/properties/[id]/playbook/route.ts`

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/lib/storage/playbook.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createPlaybookSignedUrl } from "@/lib/storage/playbook";

function fakeAdmin(result: unknown) {
  return {
    storage: { from: () => ({ createSignedUrl: vi.fn().mockResolvedValue(result) }) },
  } as never;
}

describe("createPlaybookSignedUrl", () => {
  it("returns the signed url on success", async () => {
    const admin = fakeAdmin({ data: { signedUrl: "https://x/y.pdf" }, error: null });
    expect(await createPlaybookSignedUrl(admin, "a/b.pdf")).toBe("https://x/y.pdf");
  });
  it("returns null on storage error", async () => {
    const admin = fakeAdmin({ data: null, error: { message: "nope" } });
    expect(await createPlaybookSignedUrl(admin, "a/b.pdf")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @lc/portal test playbook`
Expected: FAIL — cannot resolve `@/lib/storage/playbook`.

- [ ] **Step 3: Create the helper**

`apps/portal/lib/storage/playbook.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Playbook signed-URL lifetime — one hour, enough for a single call. */
export const PLAYBOOK_SIGNED_URL_TTL = 3600;

/**
 * Create a short-lived signed URL for a property's playbook PDF in the private
 * `playbooks` bucket. Returns null on any storage error or missing URL, so both
 * the agent and owner routes share one implementation (D9).
 */
export async function createPlaybookSignedUrl(
  admin: SupabaseClient,
  path: string,
  ttl: number = PLAYBOOK_SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from("playbooks")
    .createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @lc/portal test playbook`
Expected: PASS.

- [ ] **Step 5: Use it in the agent route**

`apps/portal/app/api/calls/[id]/playbook/route.ts` — remove `const SIGNED_URL_TTL = 3600; …`; add `import { createPlaybookSignedUrl } from "@/lib/storage/playbook";`. Replace the `createSignedUrl` block:
```ts
  const signedUrl = await createPlaybookSignedUrl(
    admin,
    property.playbook_pdf_url as string,
  );
  if (!signedUrl) {
    return NextResponse.json(
      { error: "Could not generate playbook URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    hasPlaybook: true,
    signedUrl,
    version: property.playbook_version,
  });
```

- [ ] **Step 6: Use it in the owner route**

`apps/portal/app/api/owner/properties/[id]/playbook/route.ts` — remove `const SIGNED_URL_TTL = 3600; …`; add the same import. In `GET`, replace the `createSignedUrl` block with the same `const signedUrl = await createPlaybookSignedUrl(admin, property.playbook_pdf_url as string);` + null-check + JSON response as above. (The `POST` upload path is untouched.)

- [ ] **Step 7: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal test playbook`
Expected: PASS. The existing playbook route tests must stay green: `pnpm --filter @lc/portal test calls/playbook`.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/lib/storage apps/portal/tests/lib/storage apps/portal/app/api/calls apps/portal/app/api/owner
git commit -m "refactor(phase4): shared playbook signed-URL helper (D9)"
```

---

## Task 6: Repoint password-reset seam; delete `/auth/callback` (M4)

**Files:**
- Modify: `apps/portal/app/(auth)/forgot-password/actions.ts:23`
- Delete: `apps/portal/app/auth/callback/route.ts`
- Modify: `apps/portal/app/auth/confirm/route.ts` (update the stale comment)

- [ ] **Step 1: Repoint the reset link**

`apps/portal/app/(auth)/forgot-password/actions.ts` — change line 23:
```ts
  const redirectTo = `${appUrl}/auth/callback?next=/auth/update-password`;
```
to:
```ts
  const redirectTo = `${appUrl}/auth/confirm?type=recovery&next=/auth/update-password`;
```

- [ ] **Step 2: Confirm nothing else references `/auth/callback`**

Run: `grep -rn "auth/callback" apps/portal --include=*.ts --include=*.tsx`
Expected: only the comment in `apps/portal/app/auth/confirm/route.ts`. (If any code path other than the comment references it, stop and reassess.)

- [ ] **Step 3: Delete the dead handler**

```bash
git rm apps/portal/app/auth/callback/route.ts
```
(It exchanged a PKCE `?code=` for a session — only the now-repointed reset link and the cut magic-link flow ever used it; `/auth/confirm` handles email links via `verifyOtp`.)

- [ ] **Step 4: Update the comment in confirm route**

`apps/portal/app/auth/confirm/route.ts` — in the header comment, change the phrasing that references "the previous `/auth/callback`" to past tense / "the removed `/auth/callback`" so it reads correctly now that the file is gone. (Comment-only edit; do not touch the handler logic.)

- [ ] **Step 5: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS (no dangling import of the deleted route).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/app/auth apps/portal/app/\(auth\)/forgot-password/actions.ts
git commit -m "fix(phase4): repoint password reset at /auth/confirm; delete session-dropping /auth/callback (M4)"
```

---

## Task 7: Delete dead browser Supabase client (A7)

**Files:**
- Delete: `apps/portal/lib/supabase/client.ts`

- [ ] **Step 1: Confirm zero importers**

Run: `grep -rn "supabase/client" apps/portal --include=*.ts --include=*.tsx`
Expected: no matches (the file is unused). If anything imports it, stop — it isn't dead.

- [ ] **Step 2: Delete**

```bash
git rm apps/portal/lib/supabase/client.ts
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(phase4): delete unused crash-on-import browser Supabase client (A7)"
```

---

## Task 8: Time-bound ON_CALL presence inference (S3)

A leaked IN_PROGRESS video row must no longer pin an agent "On a call" indefinitely; only a *fresh* live call counts.

**Files:**
- Create: `apps/portal/tests/app/presence.test.ts`
- Modify: `apps/portal/app/api/presence/route.ts`

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/presence.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/api-actor", () => ({ requireApiActor: vi.fn() }));

import { POST } from "@/app/api/presence/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireApiActor } from "@/lib/auth/api-actor";

function makeAdmin(liveVideoRows: Array<{ id: string }>) {
  const calls = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: liveVideoRows }),
  };
  const profilesUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
  const profiles = { update: vi.fn().mockReturnValue(profilesUpdate) };
  const admin = { from: vi.fn((t: string) => (t === "calls" ? calls : profiles)) };
  return { admin, calls, profiles };
}

const req = (status: string) =>
  new Request("http://x/api/presence", { method: "POST", body: JSON.stringify({ status }) });

beforeEach(() => vi.clearAllMocks());

describe("presence ON_CALL inference is time-bounded (S3)", () => {
  it("keeps AVAILABLE when no fresh live video call (stale row bounded out)", async () => {
    const { admin, calls, profiles } = makeAdmin([]);
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    (requireApiActor as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u1" });
    await POST(req("AVAILABLE"));
    expect(calls.gte).toHaveBeenCalledWith("answered_at", expect.any(String));
    expect(profiles.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AVAILABLE" }),
    );
  });

  it("upgrades to ON_CALL when a fresh live video call exists", async () => {
    const { admin, profiles } = makeAdmin([{ id: "c1" }]);
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    (requireApiActor as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "u1" });
    await POST(req("AVAILABLE"));
    expect(profiles.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @lc/portal test presence`
Expected: FAIL — `calls.gte` is never called (route has no staleness bound yet).

- [ ] **Step 3: Add the bound**

`apps/portal/app/api/presence/route.ts` — add `import { REAP_IN_PROGRESS_AFTER_MS } from "@lc/shared";` at top. In the `if (status === "AVAILABLE")` block, add the bound:
```ts
  let status = body.status;
  if (status === "AVAILABLE") {
    // Only a *fresh* live video call counts. A leaked IN_PROGRESS row (crashed
    // kiosk, both finalizers missed) older than the reaper's cutoff is a phantom
    // and must not pin the agent ON_CALL — mirrors the incoming-video bound (S3).
    const freshSince = new Date(Date.now() - REAP_IN_PROGRESS_AFTER_MS).toISOString();
    const { data: liveVideo } = await admin
      .from("calls")
      .select("id")
      .eq("channel", "VIDEO")
      .eq("state", "IN_PROGRESS")
      .eq("handled_by_user_id", actor.userId)
      .gte("answered_at", freshSince)
      .limit(1);
    if (liveVideo && liveVideo.length > 0) {
      status = "ON_CALL";
    }
  }
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @lc/portal test presence`
Expected: PASS (both cases).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/app/api/presence/route.ts apps/portal/tests/app/presence.test.ts
git commit -m "fix(phase4): time-bound ON_CALL presence inference (S3)"
```

---

## Task 9: Kiosk one-active-call DB guard (S8) — migration 0016

**Files:**
- Create: `supabase/migrations/0016_calls_one_active_video.sql`
- Modify: `apps/portal/app/api/kiosk/call-started/route.ts`
- Modify/Create: `apps/portal/tests/app/kiosk/call-started.test.ts`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0016_calls_one_active_video.sql`:
```sql
-- Phase 4 (S8): DB-level guard for "one active VIDEO call per property".
-- The kiosk route check-then-inserts, which races on a double-tap / reload storm.
-- A partial unique index makes the invariant atomic; the route maps 23505 -> 409.
create unique index if not exists calls_one_active_video_per_property
  on public.calls (property_id)
  where channel = 'VIDEO' and state in ('RINGING', 'IN_PROGRESS');
```

- [ ] **Step 2: Write the failing test**

Add to `apps/portal/tests/app/kiosk/call-started.test.ts` (create if absent; mirror the existing kiosk test setup if one exists):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/kiosk/config-token", () => ({
  verifyKioskToken: vi.fn(),
  getKioskConfigSecret: vi.fn(() => "secret"),
}));

import { POST } from "@/app/api/kiosk/call-started/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken } from "@/lib/kiosk/config-token";

function adminWithInsertError(code: string) {
  const property = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: "p1", operator_id: "o1", active: true },
    }),
  };
  const existing = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  };
  const insert = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: { code } }),
  };
  // properties -> property; calls -> existing on first use, insert on second
  let callsHit = 0;
  const admin = {
    from: vi.fn((t: string) => {
      if (t === "properties") return property;
      callsHit += 1;
      return callsHit === 1 ? existing : insert;
    }),
  };
  return admin as never;
}

const req = () =>
  new Request("http://x/api/kiosk/call-started", {
    method: "POST",
    headers: { "x-kiosk-token": "t" },
  });

beforeEach(() => vi.clearAllMocks());

describe("kiosk call-started DB guard (S8)", () => {
  it("maps a unique-violation (23505) insert error to 409", async () => {
    (verifyKioskToken as ReturnType<typeof vi.fn>).mockReturnValue({ propertyId: "p1" });
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminWithInsertError("23505"));
    const res = await POST(req());
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm --filter @lc/portal test call-started`
Expected: FAIL — current route ignores the insert `error` and returns 500 (`if (!inserted)`), not 409.

- [ ] **Step 4: Handle the constraint error**

`apps/portal/app/api/kiosk/call-started/route.ts` — capture and branch on the insert error:
```ts
  const { data: inserted, error: insertError } = await admin
    .from("calls")
    .insert({
      operator_id: property.operator_id,
      property_id: property.id,
      channel: "VIDEO",
      state: "RINGING",
      agora_channel_name: channelName,
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 = unique_violation: the partial index caught a concurrent active
    // VIDEO call that slipped past the check-then-insert fast-path above.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "A call is already active for this property" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }
  if (!inserted) {
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter @lc/portal test call-started`
Expected: PASS.

- [ ] **Step 6: Apply the migration locally + verify it builds clean**

Run: `supabase start` (if not running) then `supabase migration up` (or `supabase db reset` to apply from scratch).
Expected: 0016 applies with no error (no pre-existing duplicate active VIDEO rows locally).

- [ ] **Step 7: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal test call-started`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0016_calls_one_active_video.sql apps/portal/app/api/kiosk/call-started/route.ts apps/portal/tests/app/kiosk/call-started.test.ts
git commit -m "fix(phase4): DB-level one-active-video guard + 23505->409 (S8, migration 0016)"
```

---

## Task 10: Cap parallel-dial fan-out (S2)

**Files:**
- Modify: `apps/portal/lib/voice/plan-dial.ts`
- Modify: existing `planDial` test (extend; find via `grep -rln "planDial" apps/portal/tests apps/portal/lib`)
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts`

- [ ] **Step 1: Update/extend the test**

In the `planDial` test file, add (and update any existing assertions that expect an array return to use `.targets`):
```ts
import { planDial, MAX_DIAL_TARGETS } from "@/lib/voice/plan-dial";

const cand = (n: number) => ({ id: `u${n}`, twilioIdentity: `lc_${n}` });

describe("planDial fan-out cap (S2)", () => {
  it("caps at MAX_DIAL_TARGETS and reports droppedCount, priority preserved", () => {
    const admins = Array.from({ length: 11 }, (_, i) => cand(i + 1));
    const plan = planDial({ primaryAgent: null, availableAdmins: admins });
    expect(plan.targets).toHaveLength(MAX_DIAL_TARGETS);
    expect(plan.droppedCount).toBe(1);
    expect(plan.targets[0].identity).toBe("lc_1");
  });
  it("does not drop within the cap", () => {
    const plan = planDial({ primaryAgent: cand(1), availableAdmins: [cand(2)] });
    expect(plan.targets).toHaveLength(2);
    expect(plan.droppedCount).toBe(0);
  });
  it("dedupes before capping", () => {
    const plan = planDial({ primaryAgent: cand(1), availableAdmins: [cand(1), cand(2)] });
    expect(plan.targets.map((t) => t.identity)).toEqual(["lc_1", "lc_2"]);
    expect(plan.droppedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @lc/portal test plan-dial`
Expected: FAIL — `MAX_DIAL_TARGETS` undefined / `plan.targets` undefined (return is still a bare array).

- [ ] **Step 3: Implement the cap**

`apps/portal/lib/voice/plan-dial.ts` — change the return type and body:
```ts
/** Twilio `<Dial>` rejects 11+ parallel `<Client>` nouns — it breaks the whole
 *  call, not just the 11th. Cap the fan-out and report how many were dropped. */
export const MAX_DIAL_TARGETS = 10;

export interface DialPlan {
  targets: DialTarget[];
  droppedCount: number;
}

export function planDial(input: DialInput): DialPlan {
  const candidates: DialCandidate[] = [];
  if (input.primaryAgent) candidates.push(input.primaryAgent);
  candidates.push(...input.availableAdmins);

  const seen = new Set<string>();
  const deduped: DialTarget[] = [];
  for (const c of candidates) {
    if (!c.twilioIdentity) continue;
    if (seen.has(c.twilioIdentity)) continue;
    seen.add(c.twilioIdentity);
    deduped.push({ identity: c.twilioIdentity });
  }

  const targets = deduped.slice(0, MAX_DIAL_TARGETS);
  return { targets, droppedCount: deduped.length - targets.length };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @lc/portal test plan-dial`
Expected: PASS.

- [ ] **Step 5: Update the caller + warn**

`apps/portal/app/api/twilio/voice/incoming/route.ts` — add `import * as Sentry from "@sentry/nextjs";` at top. Change line 64:
```ts
    const { targets, droppedCount } = planDial({ primaryAgent, availableAdmins });
    if (droppedCount > 0) {
      Sentry.captureMessage(
        `Dial fan-out capped at ${targets.length}; ${droppedCount} candidate(s) dropped (property ${property.id})`,
        "warning",
      );
    }
```
The later uses (`targets.length === 0 ? "NO_ANSWER" : "RINGING"` and `buildIncomingTwiml(targets, …)`) are unchanged — `targets` is still the array.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal test`
Expected: PASS (full portal suite — confirms no other `planDial` caller broke).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/voice/plan-dial.ts apps/portal/app/api/twilio/voice/incoming/route.ts apps/portal/tests
git commit -m "fix(phase4): cap parallel-dial fan-out at 10 + Sentry warn (S2)"
```

---

## Task 11: Parallelize reaper + sweep cron writes (S7)

Behavior-preserving refactor (no new behavior → verification is "same writes, no longer sequential"; suite stays green). The RINGING reap and the OFFLINE sweep are already single statements; only the per-row IN_PROGRESS updates and the per-operator heartbeat loops are sequential.

**Files:**
- Modify: `apps/portal/app/api/cron/reap-stale-calls/route.ts`
- Modify: `apps/portal/app/api/cron/mark-stale-offline/route.ts`

- [ ] **Step 1: Parallelize the reap route**

`apps/portal/app/api/cron/reap-stale-calls/route.ts` — replace the IN_PROGRESS `for … of` loop with a filtered `Promise.all`:
```ts
  const staleInProgress = ((inProgressRows ?? []) as Array<{
    id: string;
    created_at: string;
    answered_at: string | null;
  }>).filter((row) => inProgressIsStale(row, now));

  await Promise.all(
    staleInProgress.map((row) =>
      admin
        .from("calls")
        .update({
          state: "FAILED",
          ended_at: endedAt,
          duration_seconds: reapDurationSeconds(row.answered_at, now),
          flagged_for_review: true,
          notes: "Auto-closed by reaper: kiosk disconnected mid-call.",
        })
        .eq("id", row.id)
        .eq("state", "IN_PROGRESS"),
    ),
  );
```
And the heartbeat loop:
```ts
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_reap_stale_calls")),
  );
```
(The RINGING `update().lt("ring_started_at", ringingBefore)` block is unchanged — already one statement.)

- [ ] **Step 2: Parallelize the sweep route**

`apps/portal/app/api/cron/mark-stale-offline/route.ts` — replace the heartbeat loop:
```ts
  const { data: operators } = await admin.from("operators").select("id");
  await Promise.all(
    (operators ?? []).map((op) => recordHeartbeat(op.id, "cron_mark_stale_offline")),
  );
```
(The `profiles` OFFLINE update is unchanged — already one statement.)

- [ ] **Step 3: Verify (behavior-identical)**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal test`
Expected: PASS. If reaper/cron route tests exist, they must stay green (same writes, same state guards).

- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/api/cron
git commit -m "perf(phase4): parallelize reaper + sweep cron writes (S7)"
```

---

## Task 12: Audit-action index (S11) — migration 0017

**Files:**
- Create: `supabase/migrations/0017_audit_action_index.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/0017_audit_action_index.sql`:
```sql
-- Phase 4 (S11): supporting index for the /admin/audit filter, which scopes by
-- operator_id, optionally filters by action, and orders by created_at desc on an
-- unboundedly growing table. Without it the action filter degrades to a scan.
create index if not exists audit_logs_operator_action_created_idx
  on public.audit_logs (operator_id, action, created_at desc);
```

- [ ] **Step 2: Apply locally + verify**

Run: `supabase migration up` (or `supabase db reset`).
Expected: 0017 applies clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0017_audit_action_index.sql
git commit -m "perf(phase4): index audit_logs(operator_id, action, created_at) (S11, migration 0017)"
```

---

## Task 13: Generated-base types + drift check (M6)

The riskiest task — a refactor of the load-bearing `supabase-types.ts`. Structure becomes machine-generated; the CHECK-constrained columns are re-narrowed by a curated overlay. Gated by full monorepo typecheck + suite.

**Files:**
- Modify: `packages/shared/package.json` (add `type-fest` dep)
- Modify: root `package.json` (add `gen:types` + `gen:types:check` scripts)
- Create: `scripts/check-types-drift.mjs`
- Create: `packages/shared/src/database.generated.ts` (via `pnpm gen:types`)
- Rewrite: `packages/shared/src/supabase-types.ts` (curated overlay)
- Modify: `apps/portal/eslint` ignore (exclude the generated file) — see Step 6

- [ ] **Step 1: Add `type-fest` to `@lc/shared`**

`packages/shared/package.json` — add a `dependencies` block (it currently has only `devDependencies`):
```json
  "dependencies": {
    "type-fest": "^4.30.0"
  },
```
Run: `pnpm install`
Expected: lockfile updates; `type-fest` resolvable from `@lc/shared`.

- [ ] **Step 2: Add the scripts**

Root `package.json` `scripts` — add:
```json
    "gen:types": "supabase gen types typescript --local > packages/shared/src/database.generated.ts && prettier --write packages/shared/src/database.generated.ts",
    "gen:types:check": "node scripts/check-types-drift.mjs",
```

- [ ] **Step 3: Create the drift-check script**

`scripts/check-types-drift.mjs`:
```js
// Regenerate DB types from the running local Supabase DB and compare to the
// committed packages/shared/src/database.generated.ts. Fails (exit 1) on drift.
// Requires `supabase start` to have run (local DB on the config.toml port).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { format } from "prettier";

const committedPath = "packages/shared/src/database.generated.ts";

const raw = execSync("supabase gen types typescript --local", {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
const fresh = (await format(raw, { parser: "typescript" })).trim();
const committed = readFileSync(committedPath, "utf8").trim();

if (fresh !== committed) {
  console.error(
    "\nDB types drift detected.\n" +
      "The committed packages/shared/src/database.generated.ts no longer matches the\n" +
      "migrations. Run `pnpm gen:types` and commit the result.\n",
  );
  process.exit(1);
}
console.log("DB types in sync.");
```

- [ ] **Step 4: Generate the base types**

Run: `supabase start` (if not running) then `pnpm gen:types`
Expected: `packages/shared/src/database.generated.ts` created, prettier-formatted, exporting `Database`, `Json`, and (depending on CLI version) `Tables`/`TablesInsert`/`Constants`. Inspect the file: confirm `calls.Row.state` is typed `string` (not a union) — that's expected; the overlay re-narrows it.

- [ ] **Step 5: Rewrite the overlay**

`packages/shared/src/supabase-types.ts` — replace the entire hand-written body with the curated overlay. Keep every previously-exported name:
```ts
// packages/shared/src/supabase-types.ts
//
// Curated overlay over the machine-generated DB structure (database.generated.ts,
// produced by `pnpm gen:types`). The generator types CHECK-constrained text
// columns as plain `string`; this overlay re-narrows them to the curated unions
// the app relies on, using type-fest's MergeDeep (the Supabase-documented pattern).
// Regenerate the base with `pnpm gen:types`; the drift check enforces it in CI.
import type { MergeDeep } from "type-fest";
import type { Database as Generated } from "./database.generated";

// =============================================================================
// String-union types for CHECK-constrained columns
// =============================================================================
export type Role = "AGENT" | "ADMIN" | "OWNER";
export type ProfileStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";
export type CallChannel = "AUDIO" | "VIDEO";
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";
export type ActorType = "USER" | "SYSTEM";
export type IncidentSeverity = "HIGH";
export type IncidentKind = "EMERGENCY_911";
export type IncidentStatus = "OPEN" | "RESOLVED";
export type KioskCtaStyle = "warm" | "accent" | "classic";

// =============================================================================
// Database — generated structure with curated column overrides
// =============================================================================
type ColumnOverrides = {
  public: {
    Tables: {
      profiles: {
        Row: { role: Role; status: ProfileStatus };
        Insert: { role: Role; status?: ProfileStatus };
        Update: { role?: Role; status?: ProfileStatus };
      };
      calls: {
        Row: { channel: CallChannel; state: CallState };
        Insert: { channel: CallChannel; state: CallState };
        Update: { channel?: CallChannel; state?: CallState };
      };
      audit_logs: {
        Row: { actor_type: ActorType };
        Insert: { actor_type?: ActorType };
        Update: { actor_type?: ActorType };
      };
      incidents: {
        Row: { severity: IncidentSeverity; kind: IncidentKind; status: IncidentStatus };
        Insert: { severity?: IncidentSeverity; kind?: IncidentKind; status?: IncidentStatus };
        Update: { severity?: IncidentSeverity; kind?: IncidentKind; status?: IncidentStatus };
      };
      properties: {
        Row: { kiosk_cta_style: KioskCtaStyle };
        Insert: { kiosk_cta_style?: KioskCtaStyle };
        Update: { kiosk_cta_style?: KioskCtaStyle };
      };
    };
  };
};

export type Database = MergeDeep<Generated, ColumnOverrides>;

export type { Json } from "./database.generated";

// =============================================================================
// Convenience aliases (unchanged public surface)
// =============================================================================
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Operator = Tables<"operators">;
export type Profile = Tables<"profiles">;
export type Property = Tables<"properties">;
export type PropertyAssignment = Tables<"property_assignments">;
export type AdminCallAvailability = Tables<"admin_call_availability">;
export type Call = Tables<"calls">;
export type AuditLog = Tables<"audit_logs">;
export type OperatorSettings = Tables<"operator_settings">;
```
**Note:** if the generated file's table key names differ (e.g. it nests under a different schema key) adjust the override keys to match exactly. If the generated file does NOT export `Json`, define `Json` locally here (copy the union from the old file) instead of re-exporting.

- [ ] **Step 6: Update ESLint ignores (generated file + scripts)**

Edit the root `eslint.config.mjs` `ignores` array — add two entries:
```js
      "**/*.generated.ts",
      "scripts/**",
```
The first keeps the machine-generated DB types out of lint (they trip recommended rules); the second keeps the new `scripts/*.mjs` (Node globals like `process`/`console`) from failing `no-undef` under `eslint .`. The generated file stays under prettier — the drift check (Step 3) prettier-formats the fresh output before comparing, and `gen:types` prettier-writes the committed file, so they match.

- [ ] **Step 7: Verify the whole monorepo**

Run: `pnpm typecheck`
Expected: PASS across `@lc/shared`, `@lc/portal`, `@lc/kiosk`. **If any importer breaks** (a column that resolved as a union now resolves as `string`, or vice-versa), add it to `ColumnOverrides` or fix the call site — do NOT re-introduce `as` casts to paper it. Iterate until green.

Run: `pnpm test`
Expected: PASS (full suite).

Run: `supabase start` (if needed) then `pnpm gen:types:check`
Expected: "DB types in sync." (the committed generated file matches a fresh generation).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/package.json package.json pnpm-lock.yaml scripts/check-types-drift.mjs packages/shared/src/database.generated.ts packages/shared/src/supabase-types.ts eslint.config.*
git commit -m "refactor(phase4): generated-base DB types + drift check (M6)"
```

---

## Task 14: Remove `as never` route casts + guard (M2)

**Files:**
- Modify: ~10 files listed below (22 cast sites)
- Create: `scripts/check-routes.mjs`
- Modify: root `package.json` (add `check:routes` script)

- [ ] **Step 1: Add the guard script**

`scripts/check-routes.mjs`:
```js
// Fails if any `as never` cast appears under apps/portal/{app,components}.
// `as never` defeats typedRoutes (renames then ship dead links). Use `as Route`
// for genuinely-dynamic hrefs; a real not-yet-built route may keep a cast only
// when annotated with `// FORWARD-REF:` on the same line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/portal/app", "apps/portal/components"];
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes("as never") && !line.includes("FORWARD-REF:")) {
            offenders.push(`${p}:${i + 1}: ${line.trim()}`);
          }
        });
    }
  }
}

for (const r of roots) walk(r);

if (offenders.length) {
  console.error(
    "Disallowed `as never` casts (use `as Route`, or annotate a real forward-ref " +
      "with `// FORWARD-REF:`):\n" + offenders.join("\n"),
  );
  process.exit(1);
}
console.log("Route casts OK.");
```

Root `package.json` `scripts` — add:
```json
    "check:routes": "node scripts/check-routes.mjs",
```

- [ ] **Step 2: Run the guard, see it list all current offenders**

Run: `pnpm check:routes`
Expected: FAIL — lists ~22 offenders.

- [ ] **Step 3: Fix the static-literal hrefs (remove the cast)**

Delete `as never` (leave the bare string literal) at:
- `apps/portal/app/(admin)/admin/properties/new/page.tsx:23` → `href={"/admin/properties"}`
- `apps/portal/app/(admin)/admin/properties/properties-table.tsx:50` and `:65` → `href={"/admin/properties/new"}`
- `apps/portal/app/(admin)/admin/properties/[id]/page.tsx:75` → `href={"/admin/properties"}`
- `apps/portal/app/(admin)/admin/properties/property-form.tsx:243` → `router.push("/admin/properties")`
- `apps/portal/app/(owner)/owner/properties/[id]/page.tsx:150` → `href={"/owner/calls"}`

- [ ] **Step 4: Fix the dynamic/interpolated hrefs (`as never` → `as Route`)**

Add `import type { Route } from "next";` to each file, then change `as never` → `as Route` at:
- `apps/portal/app/(owner)/owner/page.tsx:130` (`/owner/properties/${c.id}`)
- `apps/portal/app/(owner)/owner/calls/page.tsx:164, 175, 199, 238, 243` (`buildHref(...)`, `newestHref`, `olderHref`)
- `apps/portal/app/(owner)/owner/incidents/[id]/page.tsx:84` (`/owner/calls/${incident.call_id}`)
- `apps/portal/app/(admin)/admin/audit/audit-table.tsx:55, 61` (`router.push(`/admin/audit?...` )`)
- `apps/portal/app/(admin)/admin/properties/property-form.tsx:98` (`router.push(`/admin/properties/${result.id}`)`)
- `apps/portal/app/(admin)/admin/properties/properties-table.tsx:90` (`/admin/properties/${p.id}`)
- `apps/portal/components/owner/call-detail-body.tsx:37` (`/owner/incidents/${data.incidentId}`)
- `apps/portal/components/owner/incident-row.tsx:21` (`/owner/incidents/${incident.id}`)

(For `router.push(x as never)` → `router.push(x as Route)`.)

- [ ] **Step 5: Fix the generic nav components (type the prop)**

`apps/portal/components/nav-item.tsx` — type the `href` prop as `Route` (add `import type { Route } from "next";`, change the prop type from `string` to `Route`), and remove the inner `as never` at line 29 (`href={href}`).

`apps/portal/components/owner/owner-nav.tsx` — same: type the nav item `href` as `Route`, remove `as never` at lines 24 and 50.

If a caller of these components now fails typecheck because it passes a dynamic string, fix that call site with `as Route` (it's a real dynamic route), not by widening the prop back to `string`.

- [ ] **Step 6: Verify**

Run: `pnpm check:routes`
Expected: "Route casts OK." (zero offenders).

Run: `pnpm --filter @lc/portal typecheck`
Expected: PASS — this proves every route literal/template is a valid `Route` (the whole point of M2).

- [ ] **Step 7: Commit**

```bash
git add apps/portal scripts/check-routes.mjs package.json
git commit -m "refactor(phase4): remove 22 `as never` route casts + add cast guard (M2)"
```

---

## Task 15: GitHub Actions CI (H)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Route-cast guard
        run: pnpm check:routes

      - name: Install Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Start local Supabase (for type drift check)
        # Plain `supabase start` is reliable; it pulls the local stack via Docker
        # (~1-2 min). To trim time later, add `-x <comma,services>` to exclude
        # services the drift check doesn't need — but only with names valid for
        # the pinned CLI version (a wrong name fails the step).
        run: supabase start

      - name: DB types drift check
        run: pnpm gen:types:check
```

- [ ] **Step 2: Validate every step locally**

Run each command the workflow runs and confirm green:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm check:routes
supabase start
pnpm gen:types:check
```
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(phase4): GitHub Actions CI (lint/typecheck/test/routes/drift) (H)"
```

- [ ] **Step 4: Push the branch and confirm the Actions run is green**

```bash
git push -u origin phase4-invariants-ci
```
Watch the run (`gh run watch` or the PR Checks tab). Expected: all steps green. Fix-forward any CI-only failure (e.g. exclude-list tuning, lockfile) and re-push.

---

## Final verification (before opening the PR / merging)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` — all green (target: ~414 prior tests + new Phase 4 tests).
- [ ] `pnpm check:routes` → "Route casts OK."
- [ ] `supabase start && pnpm gen:types:check` → "DB types in sync."
- [ ] CI workflow green on the pushed branch.
- [ ] Migrations 0016 + 0017 present, apply clean on a fresh `supabase db reset`.
- [ ] `grep -rn "as never" apps/portal/app apps/portal/components` → none (or only `// FORWARD-REF:`-annotated).
- [ ] 911 path (`emergency/route.ts`) diff is the single `action:` constant swap — nothing else.

## Post-merge (prod) — established pattern

- [ ] Merge to `main` (`--no-ff` or PR), tag `plan-phase4-invariants-ci-complete`.
- [ ] Apply **0016** + **0017** to prod via Supabase MCP `apply_migration` (ref `ztunzdpmazwwwkxcpyfp`). Before 0016: confirm no pre-existing active-VIDEO duplicate (`select property_id, count(*) from calls where channel='VIDEO' and state in ('RINGING','IN_PROGRESS') group by property_id having count(*) > 1;` → expect 0 rows).
- [ ] Vercel auto-deploys on push; confirm READY.
- [ ] Prod smoke: one kiosk→agent video call (S8 index doesn't break the happy path), `/admin/audit` action filter works (S11), a no-answer audio call (dial path + S2 cap untouched at n<10).
- [ ] Update `CLAUDE.md` build-status table + `memory/project-status.md`.

---

## Self-review notes (author)

- **Spec coverage:** every workstream A–H maps to tasks — A→T1, B(M3/M2/M8)→T2/T14/T3, C(D10/D9)→T4/T5, D(M4)→T6, E(A7)→T7, F(S3/S8)→T8/T9, G(S2/S7/S11)→T10/T11/T12, H(M6/CI)→T13/T15. A4/A2 intentionally out of scope per spec §2.
- **S7 deviation (noted to user):** IN_PROGRESS reap is parallelized, not collapsed to one SQL statement (per-row `duration_seconds` would need an RPC); RINGING reap + OFFLINE sweep were already single statements. Behavior-identical.
- **Risk-ordered:** mechanical/low-risk tasks (1–12) land before the load-bearing M6 refactor (13) and the sweeping M2 edit (14); CI (15) wires last so it runs against the finished tree.
- **TDD exceptions:** T11 (pure parallelization) and T6/T7 (delete/repoint) have no new behavior to red-green — verification is typecheck + suite-stays-green, which is appropriate.
