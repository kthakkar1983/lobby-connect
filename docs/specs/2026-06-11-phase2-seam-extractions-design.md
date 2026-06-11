# Phase 2 — Security / Tenancy Seam Extractions

**Created:** 2026-06-11 (session 18). **Status:** LOCKED (user delegated judgment) — ready for `writing-plans`.
**Context:** 2026-06-10 architecture-audit remediation (`TASKS.md` Phase 2). Phase 0 (M5 docs merge),
Phase 1 (H1/H2/H3 behavior fixes), and the notes-durability interlude are all shipped to `main`.
This is the duplication-paydown phase: extract the copy-pasted invariants into single tested homes.
Per the triage it *"kills 80% of copy-paste"* and *"unblocks v2 tenancy work."*
**Audit cross-refs:** D1/A1 (P2-1), D3 (P2-2), D4/D6/A5/D8 (P2-3), A6/D2/D7 (P2-4), D5 (P2-5).
All are bucketed **BUG** in `docs/audits/2026-06-10-architecture-audit-triage.md`; none is an intended
feature or accepted risk (validated against `CLAUDE.md` locked decisions + the 2026-06-06 triage in
session 18 before this spec).

---

## 1. Scope

Five seam extractions, sequenced as one phase (the user chose "all of Phase 2" over P2-1 alone).
The phase is **behavior-preserving except for two audit-blessed fixes** that ride along on the
seam they belong in (§6). It is **pilot-proportional**: one operator, one property, a handful of
staff — so none of the deferred multi-agent/multi-tenant scoping is in scope.

**In scope (the five seams):**

- **P2-1 — `lib/auth/api-actor.ts`.** `requireApiActor()` + `fetchOperatorCall()` replace the
  `getUser → profile → operator-check → OWNER-reject` preamble copy-pasted across the **12
  user-session API routes**. This is also the **v2 multi-tenant query-layer seam** (locked decision
  #6): when v2 lands, the operator filter changes in one file.
- **P2-2 — `lib/twilio/client.ts` + `lib/voice/twiml.ts`.** `parseVerifiedTwilioWebhook()` extracts
  the `formData → params → signature → 403` ritual triplicated across the 3 HMAC webhook routes
  (`incoming`, `dial-result`, `status`); the duplicated `APOLOGY` string + local `twimlResponse()`
  helper move into `lib/voice/twiml.ts` (where `buildApologyTwiml` already lives).
- **P2-3 — grow `lib/voice/call-state.ts`.** One tested home for the call-row lifecycle invariants
  re-implemented at 5 sites: `claimCall()` (the guarded answer transaction, audio + video),
  `finalizeCallPayload()` + `computeDurationSeconds()` (the COMPLETED + duration write), and
  `ACTIVE_CALL_STATES` (the `["RINGING","IN_PROGRESS"]` literal). Locked decision #9 makes
  finalization multi-owner, so this invariant **must** be identical everywhere.
- **P2-4 — `packages/shared/src/`.** Move the Sentry PII scrubber (currently duplicated and already
  drifted — portal 40 lines vs kiosk 33) and the kiosk↔portal wire DTOs (`KioskConfig`,
  `CallStartResult`, `AgoraTokenResult`) into the shared package both apps already depend on.
- **P2-5 — `lib/audit/diff.ts`.** `diffFields()` + `emptyToNull` extract the per-field
  diff→audit-loop triplicated across the admin Server Actions (`properties/actions.ts`,
  `users/actions.ts`).

**Out of scope / non-goals:**

- **No DB / RLS / migration changes.** Zero migrations. RLS and the column-guard triggers are
  untouched. The 911 emergency state machine, routing/`planDial`, Twilio/Agora glue, and presence
  *derivation* are all unchanged.
- **No agent-assignment scoping.** Audit DEFER-V2 items (2026-06-06 #4-B/#17/#18): an
  unassigned same-operator AGENT joining/ending a call stays allowed for v1 (every authenticated
  agent is trusted staff of the one operator). `requireApiActor` gates on **role + active +
  operator**, never on per-property assignment. This is the single most important guardrail.
- **No M3 / A2 entanglement.** P2-3 grows `call-state.ts` but does **not** unify the dual `CallState`
  definition (M3 → Phase 4 / P4-4) and does **not** touch presence's asymmetric-writer shape
  (A2 → Phase 4). The ON_CALL write stays in the route's winner branch.
- **No Phase 3/4 work.** Caching/parallelization (P1/P4/P5/P8…) and scale invariants
  (S2/S8/M2/M6…) are later phases. The small LOW duplications outside TASKS Phase 2 — D9 (playbook
  signed-URL), D10 (audit-action vocabulary), D11 (cross-app token/CSS) — are **not** in scope.

**Decisions locked (session 18, user delegated to Claude's judgment):**

1. **Approach A — extract behavior-identical first, then flip the two behaviors centrally** (§2).
2. **`requireApiActor` returns a union (`ApiActor | NextResponse`), it does not throw** — matches the
   codebase's early-return-Response style; no route-level try/catch exists today except the Twilio
   webhooks.
3. **`requireApiActor` replaces only the *generic* preamble.** Route-specific authorization
   (emergency's handled-by / `canTriggerEmergency` check, the notes route's `handled_by_user_id`
   self-scope, call-state `canAnswer` checks) stays in the route, applied *after* the actor resolves.
4. **The scrubber unifies to the security-correct superset** of the two drifted copies — never the
   subset. The drift is diffed and reconciled explicitly before deleting either copy.

---

## 2. Approach — two passes

**Pass 1 — pure refactor (provably byte-identical).** Stand up all five seams and rewire every call
site to use them. Each seam initially *reproduces exactly* what the call sites do today — including
`answered`'s current allow-OWNER behavior and the absence of any `active` check. The 360 existing
tests stay green (modulo mechanical import moves). Nothing observable changes.

**Pass 2 — the two intended behavior changes (isolated, separately tested).** Flip the two A1/D1
drifts, each as its own commit with its own regression test:

- **(a) deactivated-user lockout** — implemented **once** inside `requireApiActor` (the `active`
  check), so all 12 routes gain it together rather than 12 hand-edits.
- **(b) `answered` OWNER-reject + claim-unify** — correct `answered`'s role policy to reject OWNER,
  and route its claim through the shared `claimCall()` so it gains the H3 `.select("id")` winner-gate
  it currently lacks (the audit explicitly recommended mirroring H3 onto `answered`).

**Why not the alternatives.** *(B) bundle extraction + behavior per module:* entangles the one risky
bit with the large mechanical diff — hard to review, hard to bisect a regression. *(C) behavior
first, then extract:* requires hand-adding the `active` check to ~12 routes and then deduping it —
writing the very duplication the phase exists to delete. Approach A implements each new behavior in
exactly one place.

---

## 3. Sequencing (lowest file-overlap first)

1. **P2-4** (scrub + DTOs → `packages/shared`) and **P2-5** (`diffFields`) — independent of the
   voice/call routes; no file overlap; safe openers.
2. **P2-2** (`parseVerifiedTwilioWebhook` + `APOLOGY`/`twimlResponse`) → `incoming`, `dial-result`,
   `status`.
3. **P2-1** (`requireApiActor` + `fetchOperatorCall`) → the 12 session routes (the preamble).
4. **P2-3** (`claimCall` + `finalizeCallPayload` + `ACTIVE_CALL_STATES`) → claim/finalize bodies.
   After P2-1 because it consumes the call row `fetchOperatorCall` returns. Touches `answered` /
   `answer-video` (claim) and `end-video` / `status` / `kiosk/call-ended` / `lib/calls/reaper.ts`
   (finalize) — different regions of the same files P2-1/P2-2 touched, so low conflict.
5. **Pass 2** behavior flips (§6).

---

## 4. The five seams (interfaces)

### P2-1 — `lib/auth/api-actor.ts`

```ts
export type Role = "AGENT" | "ADMIN" | "OWNER";
export interface ApiActor { userId: string; operatorId: string; role: Role; }

// session → profile; enforces active + allowed-role; admin client internally.
// Returns the actor, or a NextResponse (401/403) the route returns directly.
export async function requireApiActor(opts: { allow: Role[] }): Promise<ApiActor | NextResponse>;

// operator-scoped call fetch. Returns the row, or a 404 NextResponse.
export async function fetchOperatorCall(
  actor: ApiActor, callId: string, columns: string,
): Promise<Record<string, unknown> | NextResponse>;
```
Route shape:
```ts
const actor = await requireApiActor({ allow: ["AGENT", "ADMIN"] });
if (actor instanceof NextResponse) return actor;
const call = await fetchOperatorCall(actor, id, "id, state, agora_channel_name");
if (call instanceof NextResponse) return call;
// …route-specific authz + logic…
```

### P2-2 — `lib/twilio/client.ts` (+ `lib/voice/twiml.ts`)

```ts
// lib/twilio/client.ts — beside the existing validateTwilioSignature / publicUrlFromRequest
export async function parseVerifiedTwilioWebhook(
  request: Request,
): Promise<{ params: Record<string, string> } | NextResponse>; // 403 on bad signature

// lib/voice/twiml.ts — move the duplicated constant + helper here
export const APOLOGY_MESSAGE = "We're sorry, no one is available right now. …";
export function twimlResponse(xml: string, status?: number): NextResponse;
```
Preserves the existing `try/catch → buildApologyTwiml` degradation on thrown errors.

### P2-3 — grow `lib/voice/call-state.ts`

```ts
export const ACTIVE_CALL_STATES = ["RINGING", "IN_PROGRESS"] as const;          // D8
export function computeDurationSeconds(answeredAt: string | null, endedAt: Date): number | null; // D6
export async function claimCall(admin, callId: string, userId: string): Promise<boolean>; // D4 — true = winner
export function finalizeCallPayload(answeredAt: string | null, endedAt: Date): {
  state: "COMPLETED"; ended_at: string; duration_seconds: number | null;        // A5
};
// keep existing: canAnswer()
```
`claimCall` is the self-reporting guarded `UPDATE … .eq("state","RINGING").select("id")`; the route
keeps its winner-only `ON_CALL` write. `finalizeCallPayload` is the state-guarded COMPLETED write
shared by all finalizers; callers keep their `.eq("state","IN_PROGRESS")` guard.

### P2-4 — `packages/shared/src/`

- `sentry-scrub.ts` — unified `SENSITIVE_KEYS` + `PHONE_RE` + `scrubEvent` (superset of the two
  copies; drift reconciled first). Both apps import from `@lc/shared`.
- `kiosk-api.ts` — `KioskConfig`, `CallStartResult`, `AgoraTokenResult`. Kiosk drops local casts;
  portal routes type their JSON responses with them so contract drift fails typecheck, not the tablet.

### P2-5 — `lib/audit/diff.ts`

```ts
export function emptyToNull(v: string | null | undefined): string | null;
export function diffFields<T extends Record<string, unknown>>(
  current: T, next: Partial<T>, fields: (keyof T)[],
): { updates: Partial<T>; changes: { field: keyof T; from: unknown; to: unknown }[] };
```
Wired into `properties/actions.ts` + `users/actions.ts` (no-op early-return preserved).

---

## 5. Per-route role / active policy (the crux)

`requireApiActor`'s `allow` list per route, and the `active` gate applied to all:

| Route(s) | Today | After Phase 2 |
|---|---|---|
| `answer-video`, `end-video`, `incoming-video`, `emergency`, `emergency/control`, `notes`, `presence`, `twilio/token`, `agora/token` *(session branch)* | AGENT + ADMIN (OWNER already 403'd) | AGENT + ADMIN |
| **`twilio/voice/answered`** | AGENT + ADMIN + **OWNER** *(drift: no role check)* | **AGENT + ADMIN** *(add reject)* |
| `calls/[id]/playbook` *(agent)* | AGENT + ADMIN | AGENT + ADMIN |
| `owner/properties/[id]/playbook` | OWNER *(confirm allow-list at impl)* | OWNER |
| **all of the above** | active **and** inactive *(no check)* | **active only** |

`agora/token`'s **kiosk branch** keeps its kiosk-token auth (not a session actor); only its session
branch uses `requireApiActor`.

---

## 6. The two behavior changes (Pass 2 only)

These are the *only* observable changes in the phase. Both are BUG fixes from the triage (A1/D1), not
new features:

1. **Deactivated users lose API access.** Today middleware (`middleware.ts`) excludes `api/*` and
   never checks `active`; a deactivated user with a live JWT can still hit API routes until the token
   expires. After: `requireApiActor` rejects `active = false` with 403. Consistent with the Plan-9
   deactivation feature (which only blocked *sign-in*).
2. **`answered` rejects OWNER and uses the guarded claim.** Today `answered` selects only
   `operator_id` (no role), allows any same-operator session, and fires an unguarded claim +
   unconditional `ON_CALL`. After: OWNER → 403 (mirrors the shipped `answer-video`/`end-video` 4-A
   fix; OWNER is read-only per the 07a spec), and the claim goes through `claimCall()` so a lost race
   no-ops instead of stamping a false `ON_CALL` (mirrors H3; lower-risk on audio because Twilio
   serializes which leg bridges, but the presence-corruption path is identical).

---

## 7. Test strategy

- **New lib modules get focused unit tests** — the center of gravity moves here, away from the
  brittle route tests that hand-fake the PostgREST fluent chain (A4):
  - `requireApiActor`: unauthenticated → 401; unknown profile → 401; inactive → 403; disallowed role
    → 403; operator mismatch in `fetchOperatorCall` → 404; happy path returns the actor.
  - `claimCall`: winner true / loser false; `computeDurationSeconds` clamps ≥ 0 and handles null
    `answered_at`; `finalizeCallPayload` shape.
  - `diffFields`: changed fields produce updates+changes; no-op returns empty; `emptyToNull`.
  - `parseVerifiedTwilioWebhook`: valid signature → params; bad signature → 403.
- **Route tests get thinner** — assert "route calls the seam and maps its result," not the inlined
  query mechanics.
- **Pass-2 regression tests:** an inactive actor is rejected on a representative route; `answered`
  returns 403 for OWNER and 409 for the losing concurrent claim.
- **Gate:** full `npm test` (node + jsdom lanes) green; `lint` + `typecheck` clean. Net test count
  rises.

---

## 8. Risks & mitigations

- **Live-call-path regression (highest risk).** P2-1/P2-3 touch `answered` and `answer-video` — the
  audio + video answer paths. *Mitigation:* Pass 1 is byte-identical and test-covered; Pass 2's
  changes are tiny and isolated; the phase ships to a branch and is **prod-smoked** (force an audio
  answer + a video answer + a deactivated-user API call) before merge, per the deploy-and-smoke
  workflow (voice/video only verify on prod, not localhost).
- **Over-extraction into deferred scope.** Easy to "while I'm here" add assignment scoping.
  *Mitigation:* the §1 guardrail is explicit; `requireApiActor` has no property/assignment parameter.
- **Brittle PostgREST-mock tests breaking.** Expected (A4). *Mitigation:* the test-strategy migration
  (§7) is part of the plan, not an afterthought.
- **Scrubber drift loses a rule.** *Mitigation:* §1 decision 4 — diff the two copies, unify to the
  superset, before deleting either.

---

## 9. References

- `docs/audits/2026-06-10-architecture-audit.md` + `…-triage.md` — findings + BUG classification
- `docs/audits/2026-06-06-readiness-audit-triage.md` — the DEFER-V2 #4-B/#17/#18 guardrail (§1)
- `CLAUDE.md` — locked decisions #4 (auth/RLS), #5 (OWNER read-only), #6 (operator_id tenancy seam),
  #9 (multi-owner finalization); established `lib/` TDD + Server-Action patterns
- `docs/specs/2026-06-02-07a-owner-portal-design.md` — OWNER read-only role
- `TASKS.md` — Phase 2 task list (P2-1…P2-5)
