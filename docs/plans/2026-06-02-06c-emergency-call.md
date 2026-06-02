# 6c — Emergency Call (911 conference) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During an active inbound audio call, let the agent trigger a real 911 emergency call that merges the guest + agent + 911 dispatcher into one Twilio Conference, routed to the hotel's PSAP via the number's registered address, and log a high-priority incident.

**Architecture:** Approach B — leave the 5a/5b ring/first-wins path untouched. On trigger, stamp the call with a conference name, redirect the agent's live Twilio leg into a `<Conference>`, let the guest follow via the existing `<Dial action=/dial-result>` callback, then add a 911 leg via the REST Participants API with the registered caller ID. Conferencing an emergency leg was verified on 2026-06-02 with a 933 probe (see spec §1).

**Tech Stack:** Next.js App Router (Node runtime route handlers), Twilio Node SDK v6 (REST + TwiML), Supabase (Postgres + RLS, service-role admin client), Vitest, Tailwind + shadcn `alert-dialog`.

**Spec:** `docs/specs/2026-06-02-06c-emergency-call-design.md`

> ## 🚨 SAFETY RULE — drilled throughout this plan
> **`EMERGENCY_DIAL_NUMBER=933` for ALL development, testing, and the pilot smoke test.** `933` is the E911 address-readback **test** number — it never contacts a PSAP and never dispatches responders. The default (`911`) is the real thing. **Do NOT set `EMERGENCY_DIAL_NUMBER` to `911` until the explicit go-live gate (Task 12).** Tasks 9, 11, and 12 each re-state this.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0008_incidents_emergency.sql` | `calls.emergency_conference_name` column + `incidents` table + RLS |
| `packages/shared/src/supabase-types.ts` | Hand-written types: new column + `incidents` table + incident string-unions |
| `apps/portal/lib/emergency/dispatch.ts` | `getEmergencyDialNumber()`, `getEmergencyCallerId()` — pure |
| `apps/portal/lib/emergency/conference.ts` | `emergencyConferenceName()`, `buildConferenceTwiml()`, `shouldRouteToEmergencyConference()` — pure |
| `apps/portal/lib/emergency/guards.ts` | `canTriggerEmergency()` — pure |
| `apps/portal/lib/twilio/client.ts` | + `getTwilioRestClient()` |
| `apps/portal/lib/twilio/conference.ts` | `pickAgentLeg()` (pure) + `findAgentLeg()`, `addEmergencyParticipant()` (thin SDK wrappers) |
| `apps/portal/app/api/calls/[id]/emergency/route.ts` | The trigger route — orchestrates the merge |
| `apps/portal/app/api/twilio/voice/dial-result/route.ts` | + emergency branch (guest joins the conference) |
| `apps/portal/components/softphone/softphone.tsx` | Emergency button + confirm dialog + active banner |
| `apps/portal/components/video-call/video-call.tsx` | Remove the out-of-scope video Emergency button + stub |
| `apps/portal/.env.local` / `.env.example` | `EMERGENCY_DIAL_NUMBER` |

**Test commands** (run from `apps/portal/`): `pnpm test` (all), `pnpm test -- <file>` (one file), `pnpm typecheck`, `pnpm lint`.

---

## Task 1: Migration 0008 + hand-written types

**Files:**
- Create: `supabase/migrations/0008_incidents_emergency.sql`
- Modify: `packages/shared/src/supabase-types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_incidents_emergency.sql`:

```sql
-- 0008: Emergency call (Plan 6c).
-- Adds the conference-name flag on calls + a high-priority incidents table.

-- 1. calls: the emergency conference name. NULL = a normal call. Non-null is the
--    flag the dial-result webhook keys on to route the guest into the conference.
alter table calls
  add column if not exists emergency_conference_name text;

-- 2. incidents: one row per emergency trigger. severity/kind/status are
--    CHECK-constrained text (not enums) so future values need no destructive
--    migration. 6c only ever inserts OPEN / HIGH / EMERGENCY_911 rows.
create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references operators(id),
  property_id uuid not null references properties(id),
  call_id uuid references calls(id),
  triggered_by uuid references profiles(id),
  severity text not null default 'HIGH' check (severity in ('HIGH')),
  kind text not null default 'EMERGENCY_911' check (kind in ('EMERGENCY_911')),
  dispatched_to text not null,
  conference_name text,
  conference_sid text,
  emergency_call_sid text,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists incidents_operator_recent on incidents(operator_id, created_at desc);
create index if not exists incidents_property on incidents(property_id);
create index if not exists incidents_call on incidents(call_id);

-- 3. RLS — operator-scoped reads; writes are service-role only (no authenticated
--    write policy, mirroring audit_logs). Owner branch uses the SECURITY DEFINER
--    helper user_owns_property() to avoid the policy-recursion trap (see 0004).
alter table incidents enable row level security;

drop policy if exists "incidents_select" on incidents;
create policy "incidents_select" on incidents
  for select to authenticated
  using (
    operator_id = current_user_operator_id()
    and (
      current_user_role() = 'ADMIN'
      or triggered_by = auth.uid()
      or user_owns_property(incidents.property_id)
    )
  );
```

- [ ] **Step 2: Commit the migration**

```bash
git add supabase/migrations/0008_incidents_emergency.sql
git commit -m "feat(6c): migration 0008 — incidents table + calls.emergency_conference_name"
```

- [ ] **Step 3: Apply to the local database**

Run (from repo root): `pnpm supabase migration up`
Expected: `Applying migration 0008_incidents_emergency.sql...` with no error.
(If the CLI reports drift, `pnpm supabase db reset` replays all migrations — destructive: re-seed + re-upload the sample playbook per `memory/project-status.md` Bug 1 afterward.)

- [ ] **Step 4: Update hand-written types — `calls` column**

The types file is hand-maintained (see its header). In `packages/shared/src/supabase-types.ts`, add `emergency_conference_name` to the `calls` `Row`, `Insert`, and `Update` blocks. In `Row` add (after `notes: string | null;`):

```ts
          emergency_conference_name: string | null;
```

In `Insert` and `Update` add (after their `notes?` lines):

```ts
          emergency_conference_name?: string | null;
```

- [ ] **Step 5: Update hand-written types — incident unions + `incidents` table**

In the string-union section near the top (after `export type ActorType = ...`), add:

```ts
export type IncidentSeverity = "HIGH";
export type IncidentKind = "EMERGENCY_911";
export type IncidentStatus = "OPEN" | "RESOLVED";
```

In the `Tables` object (insert after the `audit_logs` table block, before `operator_settings`):

```ts
      incidents: {
        Row: {
          id: string;
          operator_id: string;
          property_id: string;
          call_id: string | null;
          triggered_by: string | null;
          severity: IncidentSeverity;
          kind: IncidentKind;
          dispatched_to: string;
          conference_name: string | null;
          conference_sid: string | null;
          emergency_call_sid: string | null;
          status: IncidentStatus;
          notes: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          operator_id: string;
          property_id: string;
          call_id?: string | null;
          triggered_by?: string | null;
          severity?: IncidentSeverity;
          kind?: IncidentKind;
          dispatched_to: string;
          conference_name?: string | null;
          conference_sid?: string | null;
          emergency_call_sid?: string | null;
          status?: IncidentStatus;
          notes?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          operator_id?: string;
          property_id?: string;
          call_id?: string | null;
          triggered_by?: string | null;
          severity?: IncidentSeverity;
          kind?: IncidentKind;
          dispatched_to?: string;
          conference_name?: string | null;
          conference_sid?: string | null;
          emergency_call_sid?: string | null;
          status?: IncidentStatus;
          notes?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
```

- [ ] **Step 6: Typecheck + commit**

Run (from `apps/portal/`): `pnpm typecheck`
Expected: no errors.

```bash
git add packages/shared/src/supabase-types.ts
git commit -m "feat(6c): types for incidents table + calls.emergency_conference_name"
```

---

## Task 2: `lib/emergency/dispatch.ts` (TDD)

**Files:**
- Create: `apps/portal/lib/emergency/dispatch.ts`
- Test: `apps/portal/tests/lib/emergency/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/emergency/dispatch.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { getEmergencyDialNumber, getEmergencyCallerId } from "@/lib/emergency/dispatch";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEmergencyDialNumber", () => {
  it("defaults to 911 when the env var is unset", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "");
    expect(getEmergencyDialNumber()).toBe("911");
  });

  it("returns the override when set (e.g. 933 for testing)", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "933");
    expect(getEmergencyDialNumber()).toBe("933");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("EMERGENCY_DIAL_NUMBER", "  933  ");
    expect(getEmergencyDialNumber()).toBe("933");
  });
});

describe("getEmergencyCallerId", () => {
  it("uses the property's routing_did when present", () => {
    expect(getEmergencyCallerId({ routing_did: "+14058750410" }, "+19999999999")).toBe("+14058750410");
  });

  it("falls back to the configured Twilio number when routing_did is null", () => {
    expect(getEmergencyCallerId({ routing_did: null }, "+14058750410")).toBe("+14058750410");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/lib/emergency/dispatch.test.ts`
Expected: FAIL — cannot resolve `@/lib/emergency/dispatch`.

- [ ] **Step 3: Implement**

Create `apps/portal/lib/emergency/dispatch.ts`:

```ts
/**
 * The number to dial for an emergency. Defaults to the real 911.
 *
 * SAFETY: set EMERGENCY_DIAL_NUMBER=933 for ALL dev/test/pilot work. 933 is the
 * E911 address-readback test number — it never reaches a PSAP and never
 * dispatches responders. Only production should ever resolve to "911".
 */
export function getEmergencyDialNumber(): string {
  const v = process.env.EMERGENCY_DIAL_NUMBER?.trim();
  return v && v.length > 0 ? v : "911";
}

/**
 * The caller ID for the emergency leg. MUST be a number with a registered
 * emergency address so the PSAP routing + address display are correct. Uses the
 * property's routing DID, falling back to the configured Twilio number (same
 * number for the single-tenant pilot).
 */
export function getEmergencyCallerId(
  property: { routing_did: string | null },
  fallbackNumber: string,
): string {
  return property.routing_did ?? fallbackNumber;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/lib/emergency/dispatch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/emergency/dispatch.ts apps/portal/tests/lib/emergency/dispatch.test.ts
git commit -m "feat(6c): emergency dispatch helpers (dial number + caller id)"
```

---

## Task 3: `lib/emergency/conference.ts` (TDD)

**Files:**
- Create: `apps/portal/lib/emergency/conference.ts`
- Test: `apps/portal/tests/lib/emergency/conference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/emergency/conference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emergencyConferenceName,
  buildConferenceTwiml,
  shouldRouteToEmergencyConference,
} from "@/lib/emergency/conference";

describe("emergencyConferenceName", () => {
  it("derives a stable name from the call id", () => {
    expect(emergencyConferenceName("call-123")).toBe("emg-call-123");
  });
});

describe("buildConferenceTwiml", () => {
  it("builds a Dial>Conference that starts on enter and survives the agent leaving", () => {
    const xml = buildConferenceTwiml("emg-call-123");
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">' +
        "emg-call-123" +
        "</Conference></Dial></Response>",
    );
  });

  it("escapes XML in the conference name", () => {
    expect(buildConferenceTwiml('emg-a&b')).toContain("emg-a&amp;b");
  });
});

describe("shouldRouteToEmergencyConference", () => {
  it("is true only when a conference name is stamped on the call", () => {
    expect(shouldRouteToEmergencyConference({ emergency_conference_name: "emg-x" })).toBe(true);
    expect(shouldRouteToEmergencyConference({ emergency_conference_name: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/lib/emergency/conference.test.ts`
Expected: FAIL — cannot resolve `@/lib/emergency/conference`.

- [ ] **Step 3: Implement**

Create `apps/portal/lib/emergency/conference.ts`:

```ts
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Stable per-call conference name. Doubles as the calls-row flag value. */
export function emergencyConferenceName(callId: string): string {
  return `emg-${callId}`;
}

/**
 * TwiML that joins a leg to the emergency conference. Used for BOTH the agent
 * leg (via REST redirect) and the guest leg (returned from /dial-result).
 * endConferenceOnExit=false so guest + 911 continue if the agent drops.
 */
export function buildConferenceTwiml(conferenceName: string): string {
  return (
    `${XML_DECL}<Response><Dial><Conference ` +
    `startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">` +
    `${escapeXml(conferenceName)}` +
    `</Conference></Dial></Response>`
  );
}

/** True when the call has been flagged for the emergency conference. */
export function shouldRouteToEmergencyConference(call: {
  emergency_conference_name: string | null;
}): boolean {
  return Boolean(call.emergency_conference_name);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/lib/emergency/conference.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/emergency/conference.ts apps/portal/tests/lib/emergency/conference.test.ts
git commit -m "feat(6c): emergency conference name + TwiML + routing predicate"
```

---

## Task 4: `lib/emergency/guards.ts` (TDD)

**Files:**
- Create: `apps/portal/lib/emergency/guards.ts`
- Test: `apps/portal/tests/lib/emergency/guards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/emergency/guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canTriggerEmergency } from "@/lib/emergency/guards";

const base = {
  state: "IN_PROGRESS",
  channel: "AUDIO",
  handledByUserId: "u1",
  userId: "u1",
};

describe("canTriggerEmergency", () => {
  it("allows the handling agent on an in-progress audio call", () => {
    expect(canTriggerEmergency(base)).toBe(true);
  });

  it("rejects when the call is not in progress", () => {
    expect(canTriggerEmergency({ ...base, state: "RINGING" })).toBe(false);
  });

  it("rejects video calls (emergency is audio-only in v1)", () => {
    expect(canTriggerEmergency({ ...base, channel: "VIDEO" })).toBe(false);
  });

  it("rejects a user who is not the handling agent", () => {
    expect(canTriggerEmergency({ ...base, handledByUserId: "other" })).toBe(false);
  });

  it("rejects when nobody is handling the call yet", () => {
    expect(canTriggerEmergency({ ...base, handledByUserId: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/lib/emergency/guards.test.ts`
Expected: FAIL — cannot resolve `@/lib/emergency/guards`.

- [ ] **Step 3: Implement**

Create `apps/portal/lib/emergency/guards.ts`:

```ts
export interface EmergencyGuardInput {
  state: string;
  channel: string;
  handledByUserId: string | null;
  userId: string;
}

/** Emergency may be triggered only by the agent currently on an audio call. */
export function canTriggerEmergency(i: EmergencyGuardInput): boolean {
  return (
    i.state === "IN_PROGRESS" &&
    i.channel === "AUDIO" &&
    i.handledByUserId !== null &&
    i.handledByUserId === i.userId
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/lib/emergency/guards.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/emergency/guards.ts apps/portal/tests/lib/emergency/guards.test.ts
git commit -m "feat(6c): canTriggerEmergency guard"
```

---

## Task 5: Twilio conference helpers (TDD the pure selector)

**Files:**
- Modify: `apps/portal/lib/twilio/client.ts` (add `getTwilioRestClient`)
- Create: `apps/portal/lib/twilio/conference.ts`
- Test: `apps/portal/tests/lib/twilio/conference.test.ts`

- [ ] **Step 1: Write the failing test (pure leg selector)**

Create `apps/portal/tests/lib/twilio/conference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickAgentLeg } from "@/lib/twilio/conference";

describe("pickAgentLeg", () => {
  it("returns the in-progress child leg's sid", () => {
    const sid = pickAgentLeg([
      { sid: "CAcompleted", status: "completed" },
      { sid: "CAlive", status: "in-progress" },
    ]);
    expect(sid).toBe("CAlive");
  });

  it("returns null when there is no in-progress child", () => {
    expect(pickAgentLeg([{ sid: "CAx", status: "completed" }])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickAgentLeg([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/lib/twilio/conference.test.ts`
Expected: FAIL — cannot resolve `@/lib/twilio/conference`.

- [ ] **Step 3: Add the REST client factory to `lib/twilio/client.ts`**

Append to `apps/portal/lib/twilio/client.ts`:

```ts
import { getTwilioConfig } from "@/lib/twilio/config";

/** A Twilio REST client built from the 5a voice-path credentials. */
export function getTwilioRestClient(): ReturnType<typeof twilio> {
  const { accountSid, authToken } = getTwilioConfig();
  return twilio(accountSid, authToken);
}
```

(`import twilio from "twilio";` already exists at the top of the file; do not duplicate it. If `getTwilioConfig` is already imported, do not duplicate that import either.)

- [ ] **Step 4: Implement `lib/twilio/conference.ts`**

Create `apps/portal/lib/twilio/conference.ts`:

```ts
import "server-only";
import type twilio from "twilio";

type RestClient = ReturnType<typeof twilio>;

interface ChildLeg {
  sid: string;
  status: string;
}

/** From a parent call's child legs, the SID of the one still in progress. */
export function pickAgentLeg(children: ChildLeg[]): string | null {
  const live = children.find((c) => c.status === "in-progress");
  return live ? live.sid : null;
}

/** Find the agent's live answer leg (the child of the guest's inbound call). */
export async function findAgentLeg(
  client: RestClient,
  parentCallSid: string,
): Promise<string | null> {
  if (!parentCallSid) return null;
  const children = await client.calls.list({ parentCallSid, limit: 20 });
  return pickAgentLeg(children.map((c) => ({ sid: c.sid, status: c.status })));
}

/** Add an emergency leg (911 / 933) to the conference. `to` must be an emergency
 *  number and `from` must be a number with a registered emergency address. */
export async function addEmergencyParticipant(
  client: RestClient,
  conferenceName: string,
  opts: { from: string; to: string },
): Promise<{ callSid: string | null }> {
  const p = await client
    .conferences(conferenceName)
    .participants.create({ from: opts.from, to: opts.to });
  return { callSid: p.callSid ?? null };
}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm test -- tests/lib/twilio/conference.test.ts`
Expected: PASS (3 tests).
Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/twilio/client.ts apps/portal/lib/twilio/conference.ts apps/portal/tests/lib/twilio/conference.test.ts
git commit -m "feat(6c): twilio REST client factory + conference helpers"
```

---

## Task 6: Emergency trigger route (TDD)

**Files:**
- Create: `apps/portal/app/api/calls/[id]/emergency/route.ts`
- Test: `apps/portal/tests/app/calls/emergency.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/calls/emergency.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: Record<string, unknown> | null;
let callRow: Record<string, unknown> | null;
let propertyRow: Record<string, unknown> | null;
const updateCalls: Record<string, unknown>[] = [];
const insertedIncidents: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      if (table === "calls") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
          update: (vals: Record<string, unknown>) => {
            updateCalls.push(vals);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "properties") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }) }) };
      }
      // incidents
      return {
        insert: (vals: Record<string, unknown>) => {
          insertedIncidents.push(vals);
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

const auditSpy = vi.fn(() => Promise.resolve());
vi.mock("@/lib/auth/audit", () => ({ logAuditEvent: (...a: unknown[]) => auditSpy(...a) }));

const listMock = vi.fn();
const callUpdateMock = vi.fn(() => Promise.resolve({}));
const participantsCreateMock = vi.fn();
vi.mock("@/lib/twilio/client", () => ({
  getTwilioRestClient: () => ({
    calls: Object.assign((sid: string) => ({ update: (args: unknown) => callUpdateMock(sid, args) }), {
      list: (...a: unknown[]) => listMock(...a),
    }),
    conferences: (name: string) => ({ participants: { create: (args: unknown) => participantsCreateMock(name, args) } }),
  }),
}));
vi.mock("@/lib/twilio/config", () => ({
  getTwilioConfig: () => ({ accountSid: "AC", authToken: "tok", phoneNumber: "+1FALLBACK" }),
}));

import { POST } from "@/app/api/calls/[id]/emergency/route";

function call(id: string) {
  return POST(new Request(`http://localhost:3000/api/calls/${id}/emergency`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.stubEnv("EMERGENCY_DIAL_NUMBER", "933");
  updateCalls.length = 0;
  insertedIncidents.length = 0;
  auditSpy.mockClear();
  listMock.mockReset();
  callUpdateMock.mockClear();
  participantsCreateMock.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRow = {
    id: "call-1",
    operator_id: "op-1",
    property_id: "prop-1",
    channel: "AUDIO",
    state: "IN_PROGRESS",
    twilio_call_sid: "CAparent",
    handled_by_user_id: "u1",
    emergency_conference_name: null,
  };
  propertyRow = { routing_did: "+14058750410" };
  listMock.mockResolvedValue([{ sid: "CAagent", status: "in-progress" }]);
  participantsCreateMock.mockResolvedValue({ callSid: "CA933" });
});

describe("POST /api/calls/[id]/emergency", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
  });

  it("404 when the call belongs to another operator", async () => {
    callRow = { ...(callRow as object), operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
  });

  it("409 when the caller is not the handling agent", async () => {
    callRow = { ...(callRow as object), handled_by_user_id: "someone-else" };
    expect((await call("call-1")).status).toBe(409);
  });

  it("409 when the call is not in progress", async () => {
    callRow = { ...(callRow as object), state: "RINGING" };
    expect((await call("call-1")).status).toBe(409);
  });

  it("is idempotent when already in emergency", async () => {
    callRow = { ...(callRow as object), emergency_conference_name: "emg-call-1" };
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyActive).toBe(true);
    expect(participantsCreateMock).not.toHaveBeenCalled();
  });

  it("happy path: stamps, redirects agent leg, adds 933, logs incident + audit", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    // stamped the conference name first
    expect(updateCalls[0]).toMatchObject({ emergency_conference_name: "emg-call-1" });
    // redirected the agent's live leg into the conference
    expect(callUpdateMock).toHaveBeenCalledWith("CAagent", expect.objectContaining({
      twiml: expect.stringContaining("<Conference"),
    }));
    // added the emergency leg with the registered caller id + test number
    expect(participantsCreateMock).toHaveBeenCalledWith("emg-call-1", { from: "+14058750410", to: "933" });
    // logged the incident
    expect(insertedIncidents[0]).toMatchObject({
      call_id: "call-1",
      triggered_by: "u1",
      severity: "HIGH",
      kind: "EMERGENCY_911",
      dispatched_to: "933",
      emergency_call_sid: "CA933",
      status: "OPEN",
    });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: "trigger_emergency" }));
  });

  it("falls back to redirecting the guest parent when no agent leg is live", async () => {
    listMock.mockResolvedValue([{ sid: "CAagent", status: "completed" }]);
    await call("call-1");
    expect(callUpdateMock).toHaveBeenCalledWith("CAparent", expect.objectContaining({
      twiml: expect.stringContaining("<Conference"),
    }));
    expect(participantsCreateMock).toHaveBeenCalled();
  });

  it("502 when adding the emergency leg fails", async () => {
    participantsCreateMock.mockRejectedValue(new Error("twilio boom"));
    const res = await call("call-1");
    expect(res.status).toBe(502);
    // incident still recorded with the error noted
    expect(insertedIncidents[0]).toMatchObject({ emergency_call_sid: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/app/calls/emergency.test.ts`
Expected: FAIL — cannot resolve `@/app/api/calls/[id]/emergency/route`.

- [ ] **Step 3: Implement the route**

Create `apps/portal/app/api/calls/[id]/emergency/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTwilioRestClient } from "@/lib/twilio/client";
import { getTwilioConfig } from "@/lib/twilio/config";
import { findAgentLeg, addEmergencyParticipant } from "@/lib/twilio/conference";
import { emergencyConferenceName, buildConferenceTwiml } from "@/lib/emergency/conference";
import { canTriggerEmergency } from "@/lib/emergency/guards";
import { getEmergencyDialNumber, getEmergencyCallerId } from "@/lib/emergency/dispatch";
import { logAuditEvent } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: me } = await admin
    .from("profiles")
    .select("id, operator_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 401 });
  }

  const { data: callRow } = await admin
    .from("calls")
    .select(
      "id, operator_id, property_id, channel, state, twilio_call_sid, handled_by_user_id, emergency_conference_name",
    )
    .eq("id", id)
    .maybeSingle();
  if (!callRow || callRow.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Idempotent: already escalated — return the existing conference, do nothing.
  if (callRow.emergency_conference_name) {
    return NextResponse.json({
      ok: true,
      conferenceName: callRow.emergency_conference_name,
      alreadyActive: true,
    });
  }

  if (
    !canTriggerEmergency({
      state: callRow.state,
      channel: callRow.channel,
      handledByUserId: callRow.handled_by_user_id,
      userId: user.id,
    })
  ) {
    return NextResponse.json(
      { error: "Emergency not allowed for this call" },
      { status: 409 },
    );
  }

  const confName = emergencyConferenceName(callRow.id);

  // 1. Stamp FIRST so /dial-result routes the guest into the conference once the
  //    agent leg leaves the <Dial><Client> bridge.
  await admin
    .from("calls")
    .update({ emergency_conference_name: confName })
    .eq("id", callRow.id);

  // 2. Registered caller ID for the emergency leg.
  const { data: property } = await admin
    .from("properties")
    .select("routing_did")
    .eq("id", callRow.property_id)
    .maybeSingle();
  const cfg = getTwilioConfig();
  const callerId = getEmergencyCallerId(
    { routing_did: property?.routing_did ?? null },
    cfg.phoneNumber,
  );
  const dialTo = getEmergencyDialNumber();

  const client = getTwilioRestClient();
  const parentSid = callRow.twilio_call_sid ?? "";

  // 3. Redirect the agent's live leg into the conference; the guest follows via
  //    /dial-result. Fallback: redirect the guest parent directly (agent drops,
  //    guest still reaches 911).
  let fallbackUsed = false;
  let degradedNote: string | null = null;
  try {
    const agentLeg = await findAgentLeg(client, parentSid);
    if (agentLeg) {
      await client.calls(agentLeg).update({ twiml: buildConferenceTwiml(confName) });
    } else {
      fallbackUsed = true;
      degradedNote = "no live agent leg; redirected guest parent directly (agent dropped)";
      if (parentSid) {
        await client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) });
      }
    }
  } catch (err) {
    fallbackUsed = true;
    degradedNote = `agent-leg redirect failed: ${err instanceof Error ? err.message : String(err)}`;
    try {
      if (parentSid) {
        await client.calls(parentSid).update({ twiml: buildConferenceTwiml(confName) });
      }
    } catch (err2) {
      console.error("[emergency] guest parent redirect also failed:", err2);
    }
  }

  // 4. Add the emergency leg (911 in prod; 933 in dev/test).
  let emergencyCallSid: string | null = null;
  let dispatchError: string | null = null;
  try {
    const participant = await addEmergencyParticipant(client, confName, {
      from: callerId,
      to: dialTo,
    });
    emergencyCallSid = participant.callSid;
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error("[emergency] add emergency participant failed:", err);
  }

  // 5. Log the incident (best-effort) + audit.
  const notes =
    [degradedNote, dispatchError ? `dispatch error: ${dispatchError}` : null]
      .filter(Boolean)
      .join("; ") || null;
  await admin.from("incidents").insert({
    operator_id: callRow.operator_id,
    property_id: callRow.property_id,
    call_id: callRow.id,
    triggered_by: user.id,
    severity: "HIGH",
    kind: "EMERGENCY_911",
    dispatched_to: dialTo,
    conference_name: confName,
    conference_sid: null,
    emergency_call_sid: emergencyCallSid,
    status: "OPEN",
    notes,
  });

  await logAuditEvent({
    actorUserId: user.id,
    action: "trigger_emergency",
    entityType: "call",
    entityId: callRow.id,
    details: { conferenceName: confName, dispatchedTo: dialTo, fallbackUsed, dispatchError },
  });

  if (dispatchError) {
    return NextResponse.json(
      { error: "Emergency dispatch failed", conferenceName: confName, fallbackUsed },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, conferenceName: confName, fallbackUsed });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/app/calls/emergency.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add apps/portal/app/api/calls/[id]/emergency/route.ts apps/portal/tests/app/calls/emergency.test.ts
git commit -m "feat(6c): POST /api/calls/[id]/emergency — merge guest+agent+911 conference"
```

---

## Task 7: `dial-result` emergency branch (TDD)

**Files:**
- Modify: `apps/portal/app/api/twilio/voice/dial-result/route.ts`
- Modify: `apps/portal/tests/app/twilio/dial-result.test.ts`

- [ ] **Step 1: Extend the existing test mock + add a failing test**

In `apps/portal/tests/app/twilio/dial-result.test.ts`, replace the `dialResultCurrentState` declaration and the `maybeSingle` line so the mock can also return an emergency conference name.

Replace:
```ts
let dialResultCurrentState: string | null = "RINGING";
```
with:
```ts
let dialResultCurrentState: string | null = "RINGING";
let dialResultEmergencyConf: string | null = null;
```

Replace:
```ts
      builder.maybeSingle = () =>
        Promise.resolve({ data: dialResultCurrentState ? { state: dialResultCurrentState } : null });
```
with:
```ts
      builder.maybeSingle = () =>
        Promise.resolve({
          data: dialResultCurrentState
            ? { state: dialResultCurrentState, emergency_conference_name: dialResultEmergencyConf }
            : null,
        });
```

In `beforeEach`, add after `dialResultCurrentState = "RINGING";`:
```ts
    dialResultEmergencyConf = null;
```

Add this test inside the `describe` block:
```ts
  it("routes the guest into the conference when the call is flagged emergency", async () => {
    dialResultEmergencyConf = "emg-call-1";
    const res = await POST(makeRequest({ CallSid: "CAparent", DialCallStatus: "completed" }));
    const xml = await res.text();
    expect(xml).toContain("<Conference");
    expect(xml).toContain("emg-call-1");
    // must NOT terminalize the call
    expect(updateSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/app/twilio/dial-result.test.ts`
Expected: FAIL — response is the Hangup TwiML, not a `<Conference>`.

- [ ] **Step 3: Implement the branch**

In `apps/portal/app/api/twilio/voice/dial-result/route.ts`:

Add to the imports:
```ts
import {
  shouldRouteToEmergencyConference,
  buildConferenceTwiml,
} from "@/lib/emergency/conference";
```

Change the `existing` select from:
```ts
    const { data: existing } = await admin
      .from("calls")
      .select("state")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();
```
to:
```ts
    const { data: existing } = await admin
      .from("calls")
      .select("state, emergency_conference_name")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();

    // Emergency: the agent leg was redirected into a conference, so this parent
    // (guest) leg must join the same conference instead of hanging up.
    if (existing && shouldRouteToEmergencyConference(existing)) {
      return twimlResponse(buildConferenceTwiml(existing.emergency_conference_name as string));
    }
```

(Leave the rest of the handler — the terminal-state guard + update — unchanged below this block.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/app/twilio/dial-result.test.ts`
Expected: PASS (all prior tests + the new one).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add apps/portal/app/api/twilio/voice/dial-result/route.ts apps/portal/tests/app/twilio/dial-result.test.ts
git commit -m "feat(6c): dial-result routes the guest into the emergency conference"
```

---

## Task 8: Softphone Emergency control (UI)

**Files:**
- Modify: `apps/portal/components/softphone/softphone.tsx`

No unit test (Twilio Device + DOM dialog aren't unit-testable here; covered by the Task 11 smoke). Keep edits minimal and typecheck/lint clean.

- [ ] **Step 1: Add imports**

In `apps/portal/components/softphone/softphone.tsx`, extend the lucide import and add the alert-dialog import:

Replace:
```ts
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
```
with:
```ts
import { Phone, PhoneOff, Mic, MicOff, AlertTriangle } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 2: Add state + the trigger callback**

After the existing `const [notes, setNotes] = useState("");` line, add:
```ts
  const [emergencyActive, setEmergencyActive] = useState(false);
```

After the `toggleMute` callback, add:
```ts
  const triggerEmergency = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    setEmergencyActive(true); // optimistic; the conference merge is server-side
    try {
      const res = await fetch(`/api/calls/${id}/emergency`, { method: "POST" });
      if (!res.ok) {
        // 502 = the 911 leg failed to add; the agent must fall back to verbal
        // relay / instruct the guest to hang up and dial 911 directly.
        console.error("[softphone] emergency trigger failed:", res.status);
      }
    } catch (err) {
      console.error("[softphone] emergency trigger error:", err);
    }
  }, []);
```

- [ ] **Step 3: Reset the flag when the call ends**

In the `endCall` callback, add `setEmergencyActive(false);` next to the other resets (after `setMuted(false);`):
```ts
    setMuted(false);
    setEmergencyActive(false);
```

- [ ] **Step 4: Render the Emergency button + confirm dialog + banner**

In the `phase === "in-call"` block, inside the `<div className="flex gap-2">` that holds Mute + Hang up, add the Emergency dialog **between** the Mute button and the Hang up button:

```tsx
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={emergencyActive}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700 disabled:opacity-50"
                >
                  <AlertTriangle size={16} /> {emergencyActive ? "911 active" : "Emergency"}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Trigger 911 emergency response?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This conferences emergency services into the live call (guest + you + 911).
                    Use only for a genuine emergency.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void triggerEmergency()}
                    className="bg-destructive text-destructive-foreground"
                  >
                    Yes — trigger 911
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
```

Then, immediately after that `<div className="flex gap-2">` closes, add the active banner:

```tsx
          {emergencyActive && (
            <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700">
              Emergency active — 911 is being conferenced in. Stay on the line and relay the
              property address and room number.
            </p>
          )}
```

- [ ] **Step 5: Typecheck + lint**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/components/softphone/softphone.tsx
git commit -m "feat(6c): emergency control + confirm dialog + active banner on the softphone"
```

---

## Task 9: Remove the out-of-scope video Emergency button

**Files:**
- Modify: `apps/portal/components/video-call/video-call.tsx`

> Video-call emergency is explicitly out of scope (spec §0). The kiosk guest has no PSTN leg; emergency is audio-only.

- [ ] **Step 1: Remove the Emergency button + stub dialog**

In `apps/portal/components/video-call/video-call.tsx`:
- Delete the `<button … onClick={() => setEmergencyOpen(true)} …>` Emergency button (the red `AlertTriangle` button at ~line 187-193).
- Delete the entire `{emergencyOpen && ( … )}` dialog block (~line 203-220).
- Delete the `const [emergencyOpen, setEmergencyOpen] = useState(false);` line (~line 19).
- Remove `AlertTriangle` from the lucide-react import **only if** it is no longer used elsewhere in the file.

- [ ] **Step 2: Typecheck + lint (catches any now-unused import/var)**

Run (from `apps/portal/`): `pnpm typecheck && pnpm lint`
Expected: no errors, no unused-variable warnings.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/video-call/video-call.tsx
git commit -m "feat(6c): remove out-of-scope Emergency button from the video overlay"
```

---

## Task 10: Env wiring

**Files:**
- Modify: `apps/portal/.env.local` (local, untracked)
- Modify: `apps/portal/.env.example` (if present)

- [ ] **Step 1: Set the test number locally**

> 🚨 SAFETY: this stays `933` for all dev/test. It becomes `911` only at Task 12 go-live.

Add to `apps/portal/.env.local`:
```
EMERGENCY_DIAL_NUMBER=933
```

- [ ] **Step 2: Document it in `.env.example`**

If `apps/portal/.env.example` exists, add:
```
# Number dialed for an in-call emergency. 933 = E911 address-readback TEST number
# (never reaches a PSAP). Use 933 for ALL dev/test. Set to 911 ONLY in production.
EMERGENCY_DIAL_NUMBER=933
```
Run: `git add apps/portal/.env.example && git commit -m "docs(6c): document EMERGENCY_DIAL_NUMBER (default 933 for testing)"`
(Skip the commit if `.env.example` does not exist — `.env.local` is untracked and is not committed.)

---

## Task 11: Full suite + manual smoke (the verification gate)

**Files:** none (verification only)

- [ ] **Step 1: Full automated suite + typecheck + lint**

Run (from `apps/portal/`): `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green (existing suite + the new 6c tests).

- [ ] **Step 2: Manual end-to-end smoke with 933**

> 🚨 Confirm `EMERGENCY_DIAL_NUMBER=933` in `apps/portal/.env.local` before starting. Do NOT smoke-test against real 911.

Preconditions: local Supabase up + seeded; portal running (`pnpm dev:portal`) and reachable via the cloudflared tunnel configured on the Twilio number; an agent (e.g. `alex.agent`) signed in with the softphone connected; `EMERGENCY_DIAL_NUMBER=933`.

1. Call the property's Twilio number from a phone; the agent's softphone rings.
2. Agent clicks **Accept** → call is `IN_PROGRESS`.
3. Agent clicks **Emergency** → confirm **Yes — trigger 911**.
4. **Verify on the calling phone:** you hear the registered address (11935 N I-35 Service Rd, Oklahoma City) read back inside the call — i.e. guest + agent + 933 are conferenced (this exercises the live-leg redirect + dial-result fall-through, the spec §8 residual risk).
5. **Verify in the DB:**
   ```sql
   select emergency_conference_name from calls where id = '<call id>';        -- = emg-<call id>
   select severity, kind, dispatched_to, status, emergency_call_sid, notes
     from incidents order by created_at desc limit 1;                          -- HIGH / EMERGENCY_911 / 933 / OPEN
   select action, entity_type from audit_logs order by created_at desc limit 1; -- trigger_emergency / call
   ```
6. Hang up → conference ends; the agent's call cleans up.

- [ ] **Step 3: Record the smoke result**

If all green, note "6c smoke confirmed (933)" for the status update in Task 12. If step 4 fails (no audio / agent dropped unexpectedly), the spec §4.1 fallback and §8 risk apply — debug with `superpowers:systematic-debugging` before proceeding; do NOT mark 6c complete.

---

## Task 12: Status update, go-live note, tag

**Files:**
- Modify: `memory/project-status.md`, `MEMORY.md`, `CLAUDE.md` (build-status row)

- [ ] **Step 1: Update the build-status docs**

- In `CLAUDE.md`, add a `6c` row to the build-status table: "Emergency call — `POST /api/calls/[id]/emergency` merges guest+agent+911 into a Twilio conference via the `<Dial action>` seam; migration 0008 (`incidents` + `calls.emergency_conference_name`); softphone Emergency control; verified conferenceable via 933 probe." Tag `plan-06c-emergency-complete`.
- In `memory/project-status.md`, replace the "Plan 6c — not started" line with a completed summary (files created, smoke confirmed with 933).
- In `MEMORY.md`, update the index hook to "6c complete".

- [ ] **Step 2: Add the GO-LIVE checklist entry**

In `memory/project-status.md`, add a prominent **"Before pilot go-live"** section:
```
## ⚠️ Before pilot go-live — flip emergency dialing to real 911
- Set EMERGENCY_DIAL_NUMBER=911 in the PRODUCTION environment (Vercel env), NOT in dev.
- Leave local/dev .env.local at 933.
- Re-confirm the Twilio number still shows "Emergency Address is registered" for the pilot property.
- Do a final controlled check per Twilio's emergency-calling guidance; never test by dialing real 911.
```

- [ ] **Step 3: Commit + tag**

```bash
git add CLAUDE.md memory/project-status.md MEMORY.md
git commit -m "docs(6c): mark emergency call complete + go-live 911 checklist"
git tag plan-06c-emergency-complete
```

---

## Self-review notes (already reconciled)

- **Spec coverage:** trigger route (T6), conference choreography incl. dial-result fall-through (T6+T7), 911 caller-ID/registered-number (T2+T6), `EMERGENCY_DIAL_NUMBER` 933/911 (T2,T10,T11,T12), incident + audit logging (T1+T6), schema/RLS (T1), softphone control (T8), video button removal (T9), fallbacks + 502 path (T6), smoke/residual-risk gate (T11), forward-compat (incidents columns, T1). ✓
- **Type consistency:** `buildConferenceTwiml`/`emergencyConferenceName`/`shouldRouteToEmergencyConference` (T3) reused verbatim in T6/T7; `getTwilioRestClient` (T5) consumed in T6 and mocked identically in the T6 test; `getEmergencyDialNumber`/`getEmergencyCallerId` (T2) consumed in T6; incident insert keys (T6) match the T1 `incidents.Insert` type. ✓
- **No placeholders:** every code step contains full content; commands list expected output. ✓
