# Phase 2 — Security / Tenancy Seam Extractions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the five copy-pasted invariants flagged BUG in the 2026-06-10 architecture-audit triage (D1/A1, D3, D4/D6/A5/D8, A6/D2/D7, D5) into single tested homes, and — on the auth seam they belong in — flip the two audit-blessed behavior fixes (deactivated-user API lockout, `answered` OWNER-reject + claim-guard).

**Architecture:** Two passes. Pass 1 (Tasks 1–8) is behavior-identical extraction: each seam reproduces exactly what its call sites do today; the 360 existing tests stay green. Pass 2 (Tasks 9–10) flips the two behaviors, each in one place with its own regression test. No DB/RLS/migration changes; the 911 path, routing, presence *derivation*, and `CallState` dual-definition (M3, Phase 4) are untouched. The `requireApiActor` seam gates on **role + active + operator only** — never per-property assignment (DEFER-V2 guardrail).

**Tech Stack:** Next.js 15 App Router (route handlers, Server Actions), TypeScript, Supabase JS (admin/service-role client in API routes), Vitest (node + jsdom lanes), pnpm/npm workspaces monorepo (`apps/portal`, `apps/kiosk`, `packages/shared`).

**Spec:** `docs/specs/2026-06-11-phase2-seam-extractions-design.md`

---

## Conventions for every task

- **Test runner:** from `apps/portal/`, single file = `npx vitest run <path>`; full portal suite = `npm test` (runs node + jsdom configs). `packages/shared` tests run from `packages/shared/` via `npx vitest run`.
- **Gate before each commit:** the task's own tests pass, plus `npm run lint` and `npm run typecheck` clean (run from repo root).
- **Branch:** all work on `feat/phase2-seam-extractions` (cut from `main` before Task 1).
- **Service-role rule:** API routes use `createAdminClient()` (service role) for profile/call reads, as today — `requireApiActor`/`fetchOperatorCall` preserve that.
- **`requireApiActor` replaces only the *generic* preamble** (getUser → profile → operator → role gate). Route-specific authorization stays in the route, applied *after* the actor resolves: emergency's handled-by check, the notes route's `handled_by_user_id` self-scope, `canAnswer` state checks.

---

## File Structure

**Created:**
- `apps/portal/lib/audit/diff.ts` — `diffFields()` + `emptyToNull()` (Task 1)
- `apps/portal/lib/auth/api-actor.ts` — `requireApiActor()` + `fetchOperatorCall()` (Task 5)
- `apps/portal/lib/calls/duration.ts` — `computeDurationSeconds()` (Task 7)
- `packages/shared/src/sentry-scrub.ts` — unified PII scrubber (Task 2)
- `packages/shared/src/kiosk-api.ts` — kiosk↔portal wire DTOs (Task 3)
- Tests: `tests/lib/audit/diff.test.ts`, `tests/lib/auth/api-actor.test.ts`, `tests/lib/calls/duration.test.ts`, `tests/lib/voice/call-state.test.ts`, `tests/lib/twilio/client.test.ts` (portal); `packages/shared/tests/sentry-scrub.test.ts`

**Modified:**
- `apps/portal/lib/voice/call-state.ts` — add `claimCall`, `finalizeCallPayload`, `ACTIVE_CALL_STATES` (Task 8)
- `apps/portal/lib/voice/twiml.ts` — add `APOLOGY_MESSAGE` + `twimlResponse` (Task 4)
- `apps/portal/lib/twilio/client.ts` — add `parseVerifiedTwilioWebhook` (Task 4)
- `apps/portal/lib/calls/reaper.ts` — `reapDurationSeconds` → re-export of `computeDurationSeconds` (Task 7)
- The 12 session routes (Task 6); the 3 Twilio webhooks (Task 4); the 3 video-finalize sites (Tasks 7–8); `properties/actions.ts` + `users/actions.ts` (Task 1); `apps/kiosk/src/lib/sentry.ts` + `apps/kiosk/src/types.ts` (Tasks 2–3)

---

## Task 1 — P2-5: `diffFields` + `emptyToNull` → `lib/audit/diff.ts`

**Files:**
- Create: `apps/portal/lib/audit/diff.ts`
- Test: `apps/portal/tests/lib/audit/diff.test.ts`
- Modify: `apps/portal/app/(admin)/admin/properties/actions.ts` (TEXT_FIELDS loop ~273–292; `emptyToNull` 59–62), `apps/portal/app/(admin)/admin/users/actions.ts` (import `emptyToNull` if used; otherwise leave bespoke per-field diffing — see note)

**Scope note (right-sizing D5):** Only `properties` has a uniform field loop that `diffFields` cleanly replaces. `users` uses three hand-written `if` blocks with *different* audit actions per field plus a `twilio_identity` side-effect — leave that diffing as-is; it does not fit a uniform helper. The shared win for `users` is at most importing `emptyToNull`. Do not force `users` into `diffFields`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/audit/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffFields, emptyToNull } from "@/lib/audit/diff";

describe("diffFields", () => {
  it("returns only changed fields with from/to", () => {
    const { updates, changes } = diffFields(
      { name: "A", tz: "X" },
      { name: "B", tz: "X" },
      ["name", "tz"],
    );
    expect(updates).toEqual({ name: "B" });
    expect(changes).toEqual([{ field: "name", from: "A", to: "B" }]);
  });

  it("returns empty update set when nothing changed", () => {
    const { updates, changes } = diffFields({ a: 1 }, { a: 1 }, ["a"]);
    expect(updates).toEqual({});
    expect(changes).toEqual([]);
  });
});

describe("emptyToNull", () => {
  it("trims, maps blank to null, keeps content", () => {
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("  hi ")).toBe("hi");
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd apps/portal && npx vitest run tests/lib/audit/diff.test.ts`
Expected: FAIL — cannot resolve `@/lib/audit/diff`.

- [ ] **Step 3: Implement**

```ts
// apps/portal/lib/audit/diff.ts
export function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Compare `next` against `current` over `fields`. Returns the changed subset
 * (`updates`) and a parallel `{field, from, to}` list for audit logging. Fields
 * whose value is unchanged are omitted from both. Identity comparison (`!==`),
 * matching the existing inline loops.
 */
export function diffFields<T extends Record<string, unknown>>(
  current: T,
  next: T,
  fields: readonly (keyof T)[],
): { updates: Partial<T>; changes: FieldChange[] } {
  const updates: Partial<T> = {};
  const changes: FieldChange[] = [];
  for (const field of fields) {
    if (next[field] !== current[field]) {
      updates[field] = next[field];
      changes.push({ field: String(field), from: current[field], to: next[field] });
    }
  }
  return { updates, changes };
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `cd apps/portal && npx vitest run tests/lib/audit/diff.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Rewire `properties/actions.ts`**

Delete the local `emptyToNull` (lines 59–62) and import it from `@/lib/audit/diff`. Replace the `TEXT_FIELDS` for-loop (273–292) with:

```ts
import { diffFields, emptyToNull } from "@/lib/audit/diff";
// …
const TEXT_FIELDS = [
  "name", "timezone", "owner_user_id", "routing_did", "property_phone_number",
  "after_hours_support_phone", "kiosk_welcome_message", "kiosk_apology_message",
] as const;

const { updates: textUpdates, changes } = diffFields(current, next, TEXT_FIELDS);
Object.assign(updates, textUpdates);
for (const c of changes) {
  auditEvents.push({ action: "property.edited", details: { field: c.field, from: c.from, to: c.to } });
}
// the `active` special-case (294–300) stays as-is — different action, no `field`.
```

In `users/actions.ts`: if it has its own `emptyToNull`, replace with the import; otherwise no change (its per-field diffing stays bespoke per the scope note).

- [ ] **Step 6: Run the affected suites + gate**

Run: `cd apps/portal && npm test` then `cd .. && npm run lint && npm run typecheck`
Expected: all green (no behavior change — property edit + audit output identical).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/audit/diff.ts apps/portal/tests/lib/audit/diff.test.ts "apps/portal/app/(admin)/admin/properties/actions.ts" "apps/portal/app/(admin)/admin/users/actions.ts"
git commit -m "refactor(audit): extract diffFields + emptyToNull (P2-5/D5)"
```

---

## Task 2 — P2-4a: PII scrubber → `packages/shared`

**Files:**
- Create: `packages/shared/src/sentry-scrub.ts`, `packages/shared/tests/sentry-scrub.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export), `apps/portal/lib/sentry/scrub.ts` (re-export from shared), `apps/kiosk/src/lib/sentry.ts` (import from shared)

**Note:** the two copies' core is character-identical (`SENSITIVE_KEYS`, `SENSITIVE_KEY_RE`, `isSensitiveKey`, `PHONE_RE`, `scrubPii`). The portal superset adds `scrubEvent<T>` + exported `PHONE_RE`. Unify to the superset; the shared module imports **no** Sentry SDK (kiosk uses `@sentry/react`, portal `@sentry/nextjs`) — it is pure. Each app keeps its own `init`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/sentry-scrub.test.ts
import { describe, it, expect } from "vitest";
import { scrubPii, scrubEvent, PHONE_RE } from "../src/sentry-scrub";

describe("scrubPii", () => {
  it("drops sensitive keys (known + regex)", () => {
    const out = scrubPii({ caller_number: "x", authToken: "y", room: "204" }) as Record<string, unknown>;
    expect(out).toEqual({ room: "204" });
  });
  it("redacts phone-shaped runs but keeps short numbers", () => {
    expect(scrubPii("call +1 415 555 2671 now")).toBe("call [redacted] now");
    expect(scrubPii("room 204")).toBe("room 204");
  });
  it("recurses arrays + nested objects", () => {
    expect(scrubPii({ a: [{ secret: "s", ok: 1 }] })).toEqual({ a: [{ ok: 1 }] });
  });
  it("scrubEvent returns same shape", () => {
    expect(scrubEvent({ message: "+1 415 555 2671" })).toEqual({ message: "[redacted]" });
  });
  it("PHONE_RE is exported", () => expect(PHONE_RE).toBeInstanceOf(RegExp));
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd packages/shared && npx vitest run tests/sentry-scrub.test.ts`
Expected: FAIL — cannot resolve `../src/sentry-scrub`.

- [ ] **Step 3: Implement** — copy the portal superset verbatim into `packages/shared/src/sentry-scrub.ts` (the full contents of `apps/portal/lib/sentry/scrub.ts` lines 1–40, which is the superset). Add `export * from "./sentry-scrub";` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run it; verify it passes**

Run: `cd packages/shared && npx vitest run tests/sentry-scrub.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire both apps**

- `apps/portal/lib/sentry/scrub.ts` → replace its body with `export { scrubPii, scrubEvent, PHONE_RE } from "@lc/shared";` (keep the file so existing import paths still resolve; or update importers — prefer re-export to minimize churn).
- `apps/kiosk/src/lib/sentry.ts` → delete the local `SENSITIVE_KEYS`/`SENSITIVE_KEY_RE`/`PHONE_RE`/`isSensitiveKey`/`scrubPii` (lines 3–23), import `scrubPii` from `@lc/shared`; keep `initSentry()`.

- [ ] **Step 6: Gate (both apps build)**

Run: `cd packages/shared && npx vitest run` then from root `npm run lint && npm run typecheck`
Expected: green. Confirm both apps still resolve `@lc/shared`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/sentry-scrub.ts packages/shared/src/index.ts packages/shared/tests/sentry-scrub.test.ts apps/portal/lib/sentry/scrub.ts apps/kiosk/src/lib/sentry.ts
git commit -m "refactor(shared): single PII scrubber in @lc/shared (P2-4/A6/D2)"
```

---

## Task 3 — P2-4b: kiosk↔portal wire DTOs → `packages/shared`

**Files:**
- Create: `packages/shared/src/kiosk-api.ts`
- Modify: `packages/shared/src/index.ts`; `apps/kiosk/src/types.ts` (drop local DTO casts, re-export from shared); the portal kiosk routes that return these payloads (`app/api/kiosk/config/route.ts`, `app/api/kiosk/call-started/route.ts`, `app/api/agora/token/route.ts`) to type their JSON responses.

- [ ] **Step 1:** Read `apps/kiosk/src/types.ts` and the three portal kiosk route response literals to capture the exact current field shapes of `KioskConfig`, `CallStartResult`, `AgoraTokenResult`.

- [ ] **Step 2: Write the failing test** (type-presence + shape guard)

```ts
// packages/shared/tests/kiosk-api.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type { KioskConfig, CallStartResult, AgoraTokenResult } from "../src/kiosk-api";

describe("kiosk-api DTOs", () => {
  it("KioskConfig has the wire fields", () => {
    expectTypeOf<KioskConfig>().toHaveProperty("propertyId");
  });
});
```

- [ ] **Step 3: Implement** `packages/shared/src/kiosk-api.ts` with the three interfaces exactly matching the shapes found in Step 1; re-export from `index.ts`.

- [ ] **Step 4: Run** `cd packages/shared && npx vitest run tests/kiosk-api.test.ts` → PASS.

- [ ] **Step 5: Rewire** kiosk `types.ts` to `export type { … } from "@lc/shared"`; annotate the three portal route responses with the shared types (`NextResponse.json<...>` or a typed const) so a contract drift fails typecheck.

- [ ] **Step 6: Gate** — `npm run typecheck` from root; confirm kiosk + portal both compile against the shared DTOs.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/kiosk-api.ts packages/shared/src/index.ts packages/shared/tests/kiosk-api.test.ts apps/kiosk/src/types.ts apps/portal/app/api/kiosk/config/route.ts apps/portal/app/api/kiosk/call-started/route.ts apps/portal/app/api/agora/token/route.ts
git commit -m "refactor(shared): kiosk↔portal wire DTOs in @lc/shared (P2-4/D7)"
```

---

## Task 4 — P2-2: `parseVerifiedTwilioWebhook` + `APOLOGY_MESSAGE`/`twimlResponse`

**Files:**
- Modify: `apps/portal/lib/twilio/client.ts` (add `parseVerifiedTwilioWebhook`), `apps/portal/lib/voice/twiml.ts` (add `APOLOGY_MESSAGE` + `twimlResponse`)
- Test: `apps/portal/tests/lib/twilio/client.test.ts`
- Rewire: `app/api/twilio/voice/incoming/route.ts`, `dial-result/route.ts`, `status/route.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/twilio/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/twilio/config", () => ({ getTwilioConfig: () => ({ authToken: "tok", accountSid: "AC" }) }));
const validate = vi.fn();
vi.mock("twilio", () => ({ default: { validateRequest: (...a: unknown[]) => validate(...a) } }));

import { parseVerifiedTwilioWebhook } from "@/lib/twilio/client";

function req(form: Record<string, string>, sig = "sig"): Request {
  const body = new URLSearchParams(form);
  return new Request("https://x.test/api/twilio/voice/incoming", {
    method: "POST",
    headers: { "x-twilio-signature": sig, "content-type": "application/x-www-form-urlencoded", host: "x.test", "x-forwarded-proto": "https" },
    body,
  });
}

describe("parseVerifiedTwilioWebhook", () => {
  beforeEach(() => validate.mockReset());
  it("returns params on a valid signature", async () => {
    validate.mockReturnValue(true);
    const r = await parseVerifiedTwilioWebhook(req({ CallSid: "CA1", From: "+1" }));
    expect(r).toEqual({ params: { CallSid: "CA1", From: "+1" } });
  });
  it("returns a 403 NextResponse on a bad signature", async () => {
    validate.mockReturnValue(false);
    const r = await parseVerifiedTwilioWebhook(req({ CallSid: "CA1" }, ""));
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run; verify it fails** — `cd apps/portal && npx vitest run tests/lib/twilio/client.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** in `lib/twilio/client.ts` (beside the existing helpers):

```ts
import { NextResponse } from "next/server";

/**
 * Read + HMAC-verify an inbound Twilio webhook. Returns the parsed form params,
 * or a 403 NextResponse the route returns directly. Consumes the request body.
 */
export async function parseVerifiedTwilioWebhook(
  request: Request,
): Promise<{ params: Record<string, string> } | NextResponse> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  const signature = request.headers.get("x-twilio-signature");
  const url = publicUrlFromRequest(request);
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }
  return { params };
}
```

In `lib/voice/twiml.ts` add:

```ts
export const APOLOGY_MESSAGE =
  "We're sorry, no one is available right now. Please try again or call us directly.";

export function twimlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, { status, headers: { "Content-Type": "text/xml" } });
}
```
(add `import { NextResponse } from "next/server";` to twiml.ts)

- [ ] **Step 4: Run; verify it passes** — same command → PASS.

- [ ] **Step 5: Rewire the 3 webhooks** — replace each route's inline `formData → params → signature → 403` block with:

```ts
const parsed = await parseVerifiedTwilioWebhook(request);
if (parsed instanceof NextResponse) return parsed;
const { params } = parsed;
```
Replace each route's local `APOLOGY` const + `twimlResponse` helper with imports from `@/lib/voice/twiml`. **Preserve** each route's surrounding `try/catch → buildApologyTwiml(APOLOGY_MESSAGE)` degradation exactly. `status/route.ts` keeps its bespoke terminal-state/`answered_at` finalize logic (06-06 #19/#20/#21) untouched — only its parse preamble changes.

- [ ] **Step 6: Gate** — `cd apps/portal && npm test` (Twilio webhook tests stay green) then root `npm run lint && npm run typecheck`.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/twilio/client.ts apps/portal/lib/voice/twiml.ts apps/portal/tests/lib/twilio/client.test.ts apps/portal/app/api/twilio/voice/incoming/route.ts apps/portal/app/api/twilio/voice/dial-result/route.ts apps/portal/app/api/twilio/voice/status/route.ts
git commit -m "refactor(twilio): parseVerifiedTwilioWebhook + shared APOLOGY/twimlResponse (P2-2/D3)"
```

---

## Task 5 — P2-1a: `requireApiActor` + `fetchOperatorCall` module (behavior-identical)

**Files:**
- Create: `apps/portal/lib/auth/api-actor.ts`
- Test: `apps/portal/tests/lib/auth/api-actor.test.ts`

**Important:** this task ships the module + tests only. It does **not** add the `profiles.active` check (that is Task 9). At this point `requireApiActor` reproduces today's behavior: resolve session → profile → enforce the `allow` list + operator. This keeps Task 6's rewiring byte-identical.

- [ ] **Step 1: Write the failing tests** (`tests/lib/auth/api-actor.test.ts`): mock `createServerClient` (getUser) + `createAdminClient` (profiles/calls). Cases: no user → 401; unknown profile → 401; role not in `allow` → 403; happy path returns `{userId, operatorId, role}`. For `fetchOperatorCall`: operator mismatch → 404; match → row. (Mock the admin `.from().select().eq().maybeSingle()` chain as the existing route tests do.)

- [ ] **Step 2: Run; verify it fails** — `npx vitest run tests/lib/auth/api-actor.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/portal/lib/auth/api-actor.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Role = "AGENT" | "ADMIN" | "OWNER";
export interface ApiActor { userId: string; operatorId: string; role: Role; }

/**
 * Resolve the authenticated API actor: session user → profile → role gate.
 * Returns the actor, or a NextResponse (401/403) the caller returns directly.
 * Uses the service-role client for the profile read (matches existing routes).
 * NOTE: the `active` gate is added in a later task; today this matches current
 * route behavior (role + operator only).
 */
export async function requireApiActor(
  opts: { allow: Role[] },
): Promise<ApiActor | NextResponse> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "Unknown profile" }, { status: 401 });

  if (!opts.allow.includes(me.role as Role)) {
    return NextResponse.json({ error: "Forbidden for this role" }, { status: 403 });
  }
  return { userId: me.id, operatorId: me.operator_id, role: me.role as Role };
}

/**
 * Fetch a call scoped to the actor's operator. `columns` is the select list
 * (operator_id is always included for the scope check). Returns the row, or a
 * 404 NextResponse.
 */
export async function fetchOperatorCall(
  actor: ApiActor,
  callId: string,
  columns: string,
): Promise<Record<string, unknown> | NextResponse> {
  const admin = createAdminClient();
  const select = columns.includes("operator_id") ? columns : `${columns}, operator_id`;
  const { data: call } = await admin
    .from("calls")
    .select(select)
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.operator_id !== actor.operatorId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  return call as Record<string, unknown>;
}
```

- [ ] **Step 4: Run; verify it passes** — → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/auth/api-actor.ts apps/portal/tests/lib/auth/api-actor.test.ts
git commit -m "feat(auth): requireApiActor + fetchOperatorCall seam (P2-1/D1, behavior-identical)"
```

---

## Task 6 — P2-1b: rewire the 12 session routes (behavior-identical)

**Transform (identical per route):** replace the route's `getUser → 401 → profiles select → 401 → [OWNER 403] → call select → 404` preamble with:

```ts
const actor = await requireApiActor({ allow: [/* per table below */] });
if (actor instanceof NextResponse) return actor;
// call routes only:
const call = await fetchOperatorCall(actor, id, "<the route's existing column list>");
if (call instanceof NextResponse) return call;
```
Then replace later references: `user.id` → `actor.userId`, `me.operator_id` → `actor.operatorId`, `me.role` → `actor.role`, and read call fields off `call`. **Keep all route-specific logic** after the preamble.

**Per-route `allow` list + deviations (preserve CURRENT behavior — `answered` stays allow-OWNER until Task 10):**

| Route | `allow` | Uses `fetchOperatorCall`? | Keep after preamble |
|---|---|---|---|
| `calls/[id]/answer-video` | `["AGENT","ADMIN"]` | yes (`id, state, agora_channel_name`) | `canAnswer` + the H3 self-reporting claim |
| `calls/[id]/end-video` | `["AGENT","ADMIN"]` | yes (`id, state, answered_at`) | the IN_PROGRESS finalize |
| `calls/incoming-video` | `["AGENT","ADMIN"]` | no (queries RINGING set) | the time-bounded RINGING query |
| `calls/[id]/emergency` | `["AGENT","ADMIN"]` | yes | **all** emergency claim/dispatch + handled-by logic |
| `calls/[id]/emergency/control` | `["AGENT","ADMIN"]` | yes | handled-by + leg-control logic |
| `calls/[id]/playbook` *(agent)* | `["AGENT","ADMIN"]` | yes | signed-URL logic |
| `calls/notes` | `["AGENT","ADMIN"]` | (own fetch, `handled_by_user_id=actor.userId`) | the self-scoped note write |
| `presence` | `["AGENT","ADMIN"]` | no | heartbeat write |
| `twilio/token` | `["AGENT","ADMIN"]` | no | token mint |
| `agora/token` *(session branch only)* | `["AGENT","ADMIN"]` | branch-dependent | **kiosk-token branch unchanged** |
| `twilio/voice/answered` | `["AGENT","ADMIN","OWNER"]` *(matches today — no role gate)* | own fetch | unguarded claim (changed in Task 10) |
| `owner/properties/[id]/playbook` | `["OWNER"]` *(confirm: add ADMIN only if an admin path exists)* | no (fetches property) | property/signed-URL logic |

- [ ] **Step 1:** For each route, apply the transform with its `allow` value. `agora/token`: wrap only the session branch; leave the kiosk-token branch exactly as-is.
- [ ] **Step 2: Run the full suite** — `cd apps/portal && npm test`. The existing route tests must stay green unchanged (behavior identical). If a test breaks because it asserted inlined query mechanics (A4 brittle mocks), update it to assert via the new seam — do **not** change route behavior.
- [ ] **Step 3: Gate** — root `npm run lint && npm run typecheck`.
- [ ] **Step 4: Commit**

```bash
git add apps/portal/app/api
git commit -m "refactor(api): route 12 session handlers through requireApiActor (P2-1/D1)"
```

---

## Task 7 — P2-3a: `computeDurationSeconds` → `lib/calls/duration.ts`

**Files:** Create `apps/portal/lib/calls/duration.ts` + `tests/lib/calls/duration.test.ts`; modify `lib/calls/reaper.ts`, `app/api/calls/[id]/end-video/route.ts`, `app/api/kiosk/call-ended/route.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/calls/duration.test.ts
import { describe, it, expect } from "vitest";
import { computeDurationSeconds } from "@/lib/calls/duration";

describe("computeDurationSeconds", () => {
  it("rounds whole seconds from answeredAt to endedAtMs", () => {
    const answered = "2026-06-11T00:00:00.000Z";
    expect(computeDurationSeconds(answered, Date.parse(answered) + 90_400)).toBe(90);
  });
  it("returns null when answeredAt is null", () => {
    expect(computeDurationSeconds(null, Date.now())).toBeNull();
  });
  it("clamps negative to 0", () => {
    const answered = "2026-06-11T00:00:10.000Z";
    expect(computeDurationSeconds(answered, Date.parse(answered) - 5000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run; verify it fails.**

- [ ] **Step 3: Implement**

```ts
// apps/portal/lib/calls/duration.ts
/**
 * Whole-second call duration, clamped >= 0, or null when never answered.
 * Single source for every finalizer (decision #9 makes finalization multi-owner).
 */
export function computeDurationSeconds(
  answeredAt: string | null,
  endedAtMs: number,
): number | null {
  if (!answeredAt) return null;
  return Math.max(0, Math.round((endedAtMs - new Date(answeredAt).getTime()) / 1000));
}
```

- [ ] **Step 4: Run; verify it passes.**

- [ ] **Step 5: Rewire the 3 sites**
- `lib/calls/reaper.ts`: replace `reapDurationSeconds`'s body with `return computeDurationSeconds(answeredAt, endedAtMs);` (or re-export) — keep the name so the cron route import is unchanged.
- `end-video/route.ts` (55–60): `const durationSeconds = computeDurationSeconds(call.answered_at as string | null, endedAt.getTime());`
- `kiosk/call-ended/route.ts` (43–45): same.

- [ ] **Step 6: Gate** — `cd apps/portal && npm test`; root lint + typecheck. Reaper tests stay green.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/calls/duration.ts apps/portal/tests/lib/calls/duration.test.ts apps/portal/lib/calls/reaper.ts apps/portal/app/api/calls/[id]/end-video/route.ts apps/portal/app/api/kiosk/call-ended/route.ts
git commit -m "refactor(calls): single computeDurationSeconds (P2-3/D6)"
```

---

## Task 8 — P2-3b: `claimCall` + `finalizeCallPayload` + `ACTIVE_CALL_STATES`

**Files:** Modify `apps/portal/lib/voice/call-state.ts` (+ `tests/lib/voice/call-state.test.ts`); rewire claim in `answer-video` and finalize in `end-video` + `kiosk/call-ended`. (`answered`'s claim is unified in Task 10, where its behavior change is intentional.)

- [ ] **Step 1: Write the failing test** for `ACTIVE_CALL_STATES` membership, `finalizeCallPayload("COMPLETED", answeredAt, endedAt)` shape (state/ended_at/duration via `computeDurationSeconds`), and `claimCall` winner/loser (mock the admin update chain returning `[{id}]` vs `[]`).

- [ ] **Step 2: Run; verify it fails.**

- [ ] **Step 3: Implement** in `lib/voice/call-state.ts` (keep `canAnswer`):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDurationSeconds } from "@/lib/calls/duration";

export const ACTIVE_CALL_STATES = ["RINGING", "IN_PROGRESS"] as const;

/**
 * Atomically claim a RINGING call for `userId`. Self-reporting: zero touched
 * rows means a concurrent accept won (the loser must NOT proceed). Returns
 * true iff this caller is the winner. (H3 pattern — the only correct claim.)
 */
export async function claimCall(
  admin: SupabaseClient,
  callId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("calls")
    .update({ state: "IN_PROGRESS", handled_by_user_id: userId, answered_at: new Date().toISOString() })
    .eq("id", callId)
    .eq("state", "RINGING")
    .select("id");
  return !!data && data.length > 0;
}

/** State-guarded finalize payload. Callers keep their own `.in/.eq(state)` guard. */
export function finalizeCallPayload(
  state: "COMPLETED" | "NO_ANSWER" | "FAILED",
  answeredAt: string | null,
  endedAt: Date,
): { state: typeof state; ended_at: string; duration_seconds: number | null } {
  return {
    state,
    ended_at: endedAt.toISOString(),
    duration_seconds: computeDurationSeconds(answeredAt, endedAt.getTime()),
  };
}
```

- [ ] **Step 4: Run; verify it passes.**

- [ ] **Step 5: Rewire**
- `answer-video` (51–64): `const won = await claimCall(admin, id, actor.userId); if (!won) return NextResponse.json({ error: "Already answered" }, { status: 409 });` (the winner-only `ON_CALL` write stays).
- `end-video` (63–71): `.update(finalizeCallPayload("COMPLETED", call.answered_at as string | null, endedAt)).eq("id", id).eq("state", "IN_PROGRESS")`.
- `kiosk/call-ended` (50–59): `.update(finalizeCallPayload(nextState, call.answered_at, endedAt)).eq("id", body.callId).eq("property_id", verified.propertyId).in("state", ACTIVE_CALL_STATES)`.

- [ ] **Step 6: Gate** — `cd apps/portal && npm test` (answer-video race test + finalize tests green); root lint + typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/lib/voice/call-state.ts apps/portal/tests/lib/voice/call-state.test.ts apps/portal/app/api/calls/[id]/answer-video/route.ts apps/portal/app/api/calls/[id]/end-video/route.ts apps/portal/app/api/kiosk/call-ended/route.ts
git commit -m "refactor(calls): shared claimCall + finalizeCallPayload + ACTIVE_CALL_STATES (P2-3/D4/A5/D8)"
```

---

## Task 9 — Pass 2: deactivated users lose API access (the `active` gate)

**Files:** Modify `apps/portal/lib/auth/api-actor.ts`; add a regression test.

- [ ] **Step 1: Add the failing test** to `tests/lib/auth/api-actor.test.ts`: a profile with `active: false` → `requireApiActor` returns a 403 NextResponse. (Update the profile mock to include `active`.)

- [ ] **Step 2: Run; verify it fails** (currently no active check) — the new case fails, others pass.

- [ ] **Step 3: Implement** — in `requireApiActor`, add `active` to the select and the gate:

```ts
    .select("id, operator_id, role, active")
// …after the !me check:
  if (!me.active) {
    return NextResponse.json({ error: "Account deactivated" }, { status: 403 });
  }
```

- [ ] **Step 4: Run; verify it passes.** All 12 routes now reject a deactivated session in one place.

- [ ] **Step 5: Gate** — `cd apps/portal && npm test`; root lint + typecheck. (No route test asserted a deactivated user passing, so none should break; if one seeded `active:false` fixtures expecting 200, fix the fixture.)

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/auth/api-actor.ts apps/portal/tests/lib/auth/api-actor.test.ts
git commit -m "fix(auth): reject deactivated users on API routes (A1/D1 drift)"
```

---

## Task 10 — Pass 2: `answered` OWNER-reject + guarded claim

**Files:** Modify `apps/portal/app/api/twilio/voice/answered/route.ts`; add `apps/portal/tests/app/twilio/answered.test.ts` cases.

- [ ] **Step 1: Add failing tests** — OWNER actor → 403; losing concurrent claim → 409 (claimCall returns false). (Mock as the answer-video test does.)

- [ ] **Step 2: Run; verify they fail** (today `answered` allows OWNER and fires an unguarded claim).

- [ ] **Step 3: Implement two changes**
- Change the route's `requireApiActor` allow list from `["AGENT","ADMIN","OWNER"]` to `["AGENT","ADMIN"]`.
- Replace the unguarded claim + unconditional `ON_CALL` with:
```ts
const won = await claimCall(admin, body.callId, actor.userId);
if (!won) return NextResponse.json({ error: "Already answered" }, { status: 409 });
await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", actor.userId);
```

- [ ] **Step 4: Run; verify they pass.**

- [ ] **Step 5: Gate** — `cd apps/portal && npm test`; root lint + typecheck.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/app/api/twilio/voice/answered/route.ts apps/portal/tests/app/twilio/answered.test.ts
git commit -m "fix(voice): answered rejects OWNER + uses guarded claim (A1/H3 mirror)"
```

---

## Final gate — before opening the PR

- [ ] `npm test` (full: node + jsdom + packages/shared) — all green; net count up.
- [ ] `npm run lint` + `npm run typecheck` — clean.
- [ ] Push `feat/phase2-seam-extractions`; Vercel preview builds green.
- [ ] **Prod smoke (voice/video only verify on prod):** after merge + deploy — (1) a real AUDIO call answered by an agent (claim + ON_CALL), (2) a VIDEO call answered + ended (finalize + duration), (3) a deactivated user hitting any API route → 403, (4) an OWNER cannot answer audio. Per deploy-and-smoke-workflow.
- [ ] Update `TASKS.md` (check off P2-1…P2-5), `CLAUDE.md` build-status row, `memory/project-status.md`.

---

## Self-Review

**Spec coverage:** P2-1 → Tasks 5/6 (+ behavior in 9/10); P2-2 → Task 4; P2-3 → Tasks 7/8; P2-4 → Tasks 2/3; P2-5 → Task 1. The two Pass-2 behaviors (spec §6) → Tasks 9/10. Guardrails (no assignment scoping, no M3/A2, no migrations) honored — `requireApiActor` has no property/assignment param; `call-state` gains functions without touching the `CallState` type; zero migrations. ✓

**Placeholder scan:** Task 3 and Task 6's owner-playbook allow-list carry explicit "confirm at impl" reads (Step 1 of Task 3; the table note) — these are bounded verification steps with the exact files named, not vague TODOs. `emptyToNull`/scrub bodies are "move verbatim from <file:line>" — exact, not placeholder. ✓

**Type consistency:** `ApiActor {userId, operatorId, role}` defined in Task 5, consumed unchanged in Tasks 6/9/10. `computeDurationSeconds(answeredAt, endedAtMs)` (Task 7) consumed by `finalizeCallPayload` (Task 8). `ACTIVE_CALL_STATES`/`claimCall` (Task 8) used in Tasks 8/10. `diffFields` returns `{updates, changes}` (Task 1) — `changes[].field/from/to` matches the `property.edited` details shape. ✓
