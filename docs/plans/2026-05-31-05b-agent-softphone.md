# Plan 5b — Agent/Admin Softphone + Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inbound audio calls answerable in the browser — register each call-taker's browser as a Twilio Device, ring it, let them Accept/Decline, run in-call controls, capture room#/notes, and track presence — for both AGENT and ADMIN.

**Architecture:** Pure, unit-tested helpers in `apps/portal/lib/voice/` (presence + call-state) and `apps/portal/lib/twilio/` (access-token builder), thin Node-runtime API routes (`token`, `presence`, `voice/answered`, `calls/notes`, `cron/mark-stale-offline`) that verify the session and write via the right Supabase client, one additive extension to 5a's TwiML (pass `callId` to the browser), and one shared `"use client"` softphone component mounted in both portal shells. Presence lives in `profiles.status` (extended with `AWAY`) refreshed by a heartbeat + a once-a-minute Vercel Cron sweep.

**Tech Stack:** Next.js 15 App Router (route handlers `runtime='nodejs'`, Server Components), `twilio` Node SDK v6 (`jwt.AccessToken` + `VoiceGrant`), `@twilio/voice-sdk` (browser Device — new dep), Supabase user-scoped (`createServerClient`) + service-role (`createAdminClient`) clients, Vitest (Node env).

**Spec:** `docs/specs/2026-05-31-05b-agent-softphone-design.md`
**Builds on:** tag `plan-05a-voice-backend-complete` (smoke-confirmed `t13-smoke-confirmed`)

**Conventions reused (verified in repo):**
- Path alias `@/` → `apps/portal/`. DB types: `@lc/shared/database.types`; `Role` from `@lc/shared`.
- User-scoped client: `import { createServerClient } from "@/lib/supabase/server"` (async; `await createServerClient()`). Service-role: `import { createAdminClient } from "@/lib/supabase/admin"`.
- Session in a route: `const supabase = await createServerClient(); const { data: { user } } = await supabase.auth.getUser();`.
- Twilio glue from 5a: `lib/twilio/config.ts` (`getTwilioConfig`), `lib/twilio/client.ts`, `lib/voice/identity.ts` (`toTwilioIdentity`), `lib/voice/twiml.ts`.
- Tests live in `apps/portal/tests/...`; run from `apps/portal/` with `pnpm test` (alias `vitest run`). Vitest style: `import { describe, it, expect, vi } from "vitest"`. Node test env only (no jsdom configured) — every test in this plan is a pure-function or route test; the one React component (Task 11) is intentionally not unit-tested.
- Routes return TwiML/JSON via `NextResponse`; webhooks/cron set `export const runtime = "nodejs"`.
- All commands run from `apps/portal/` unless noted. Lint scope is `app components lib`.

**Confirmed schema:**
- `profiles(id, operator_id, full_name, role, twilio_identity, status, last_seen_at, active, ...)`; after Task 2, `status in ('AVAILABLE','ON_CALL','AWAY','OFFLINE')` default `'OFFLINE'`.
- `calls(id, operator_id, property_id, channel, state, twilio_call_sid unique, caller_number, handled_by_user_id, room_number, ring_started_at, answered_at, ended_at, duration_seconds, notes, ...)`; `state in ('RINGING','IN_PROGRESS','COMPLETED','NO_ANSWER','FAILED')`.

---

## Task 1: Add browser Voice SDK + Twilio API-key credentials getter

**Files:**
- Modify: `apps/portal/package.json` (add `@twilio/voice-sdk`)
- Modify: `apps/portal/lib/twilio/config.ts` (add `getTwilioApiCredentials`)
- Test: `apps/portal/tests/lib/twilio/config.test.ts` (add cases)

- [ ] **Step 1: Install the browser Voice SDK**

Run (from `apps/portal/`):
```bash
pnpm add @twilio/voice-sdk
```
Expected: `@twilio/voice-sdk` appears under `dependencies`.

- [ ] **Step 2: Write the failing test**

Append to `apps/portal/tests/lib/twilio/config.test.ts` (new `describe` block; keep existing tests):
```ts
import { getTwilioApiCredentials } from "@/lib/twilio/config";

describe("getTwilioApiCredentials", () => {
  it("returns accountSid + API key sid/secret when all set", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK123");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret123");

    expect(getTwilioApiCredentials()).toEqual({
      accountSid: "AC123",
      apiKeySid: "SK123",
      apiKeySecret: "secret123",
    });
  });

  it("throws when an API key var is missing", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_API_KEY_SID", "");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "secret123");

    expect(() => getTwilioApiCredentials()).toThrow(/Missing TWILIO_API_KEY/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/lib/twilio/config.test.ts`
Expected: FAIL — `getTwilioApiCredentials` is not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `apps/portal/lib/twilio/config.ts`:
```ts
export interface TwilioApiCredentials {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
}

/**
 * Reads the credentials needed to mint browser access tokens (Plan 5b).
 * API key/secret are separate from the auth token used for webhook HMAC.
 */
export function getTwilioApiCredentials(): TwilioApiCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error(
      "Missing TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, or TWILIO_API_KEY_SECRET env vars",
    );
  }

  return { accountSid, apiKeySid, apiKeySecret };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/lib/twilio/config.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/package.json apps/portal/pnpm-lock.yaml ../../pnpm-lock.yaml apps/portal/lib/twilio/config.ts apps/portal/tests/lib/twilio/config.test.ts
git commit -m "feat(5b): browser voice SDK + twilio API-key credentials getter"
```
(If only the root lockfile changed, the missing path is skipped harmlessly.)

---

## Task 2: Migration 0006 — add `AWAY` to `profiles.status`

**Files:**
- Create: `supabase/migrations/0006_status_away.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_status_away.sql`:
```sql
-- 5b presence: agents toggle Ready/Away. "Away" = connected but not accepting.
-- Display-only in v1 (routing untouched); enables a future one-line routing gate.
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('AVAILABLE', 'ON_CALL', 'AWAY', 'OFFLINE'));
```

- [ ] **Step 2: Apply + verify**

Run (from repo root):
```bash
supabase db reset
```
Then verify the constraint accepts `AWAY`:
```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "update profiles set status='AWAY' where role='AGENT'; select full_name, status from profiles where status='AWAY';"
```
Expected: agent rows update without a constraint error. (Reset restores seed afterward; this is just a probe.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_status_away.sql
git commit -m "feat(5b): migration 0006 — add AWAY to profiles.status"
```

---

## Task 3: `lib/voice/presence.ts` — pure presence helpers

**Files:**
- Create: `apps/portal/lib/voice/presence.ts`
- Test: `apps/portal/tests/lib/voice/presence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/presence.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import {
  isStale,
  STALE_AFTER_MS,
  DEFAULT_LOGIN_STATUS,
  isLiveStatus,
  type PresenceStatus,
} from "@/lib/voice/presence";

describe("isStale", () => {
  const now = Date.parse("2026-05-31T12:00:00.000Z");

  it("treats a null last_seen as stale", () => {
    expect(isStale(null, now)).toBe(true);
  });

  it("is not stale within the window", () => {
    const recent = new Date(now - (STALE_AFTER_MS - 1000)).toISOString();
    expect(isStale(recent, now)).toBe(false);
  });

  it("is stale past the window", () => {
    const old = new Date(now - (STALE_AFTER_MS + 1000)).toISOString();
    expect(isStale(old, now)).toBe(true);
  });
});

describe("constants + guards", () => {
  it("defaults a fresh login to AVAILABLE", () => {
    expect(DEFAULT_LOGIN_STATUS).toBe<PresenceStatus>("AVAILABLE");
  });

  it("isLiveStatus accepts agent-settable statuses only", () => {
    expect(isLiveStatus("AVAILABLE")).toBe(true);
    expect(isLiveStatus("AWAY")).toBe(true);
    expect(isLiveStatus("ON_CALL")).toBe(true);
    expect(isLiveStatus("OFFLINE")).toBe(false);
    expect(isLiveStatus("bogus")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/presence.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/presence`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/presence.ts`:
```ts
export type PresenceStatus = "AVAILABLE" | "ON_CALL" | "AWAY" | "OFFLINE";

/** A browser that hasn't checked in for this long is swept OFFLINE by cron. */
export const STALE_AFTER_MS = 90_000;

/** On login the agent is Ready (zero-friction pilot). Strict default deferred. */
export const DEFAULT_LOGIN_STATUS: PresenceStatus = "AVAILABLE";

const LIVE_STATUSES: ReadonlySet<string> = new Set([
  "AVAILABLE",
  "AWAY",
  "ON_CALL",
]);

/** Statuses a browser may set on itself. OFFLINE is cron-only. */
export function isLiveStatus(value: string): value is PresenceStatus {
  return LIVE_STATUSES.has(value);
}

/** True when last_seen is missing or older than the stale window. */
export function isStale(lastSeenAtIso: string | null, now: number): boolean {
  if (!lastSeenAtIso) return true;
  const seen = Date.parse(lastSeenAtIso);
  if (Number.isNaN(seen)) return true;
  return now - seen > STALE_AFTER_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/presence.ts apps/portal/tests/lib/voice/presence.test.ts
git commit -m "feat(5b): pure presence helpers (staleness, live-status guard, login default)"
```

---

## Task 4: `lib/voice/call-state.ts` — pure answer/hangup guards

**Files:**
- Create: `apps/portal/lib/voice/call-state.ts`
- Test: `apps/portal/tests/lib/voice/call-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/call-state.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import { canAnswer } from "@/lib/voice/call-state";

describe("canAnswer", () => {
  it("allows answering only a RINGING call", () => {
    expect(canAnswer("RINGING")).toBe(true);
  });

  it("rejects answering an already-progressing or finished call", () => {
    for (const s of ["IN_PROGRESS", "COMPLETED", "NO_ANSWER", "FAILED"]) {
      expect(canAnswer(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/call-state.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/call-state`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/call-state.ts`:
```ts
/**
 * A call may be transitioned to IN_PROGRESS (answered) only from RINGING.
 * Guards the race where two rung browsers both report an answer — the second
 * sees a non-RINGING state and no-ops.
 */
export function canAnswer(currentState: string): boolean {
  return currentState === "RINGING";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/call-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/call-state.ts apps/portal/tests/lib/voice/call-state.test.ts
git commit -m "feat(5b): pure canAnswer guard"
```

---

## Task 5: Pass `callId` to the browser via TwiML (5a extension)

**Context:** 5a emits `<Client>lc_x</Client>`. The text form can't carry parameters, so we switch to the nested `<Client><Identity>…</Identity><Parameter name="callId" value="…"/></Client>` form, and the `/incoming` route now needs the inserted `calls.id` to fill that value. The browser reads it as `call.customParameters.get("callId")`.

**Files:**
- Modify: `apps/portal/lib/voice/twiml.ts` (`buildIncomingTwiml` + `IncomingTwimlOpts`)
- Modify: `apps/portal/tests/lib/voice/twiml.test.ts`
- Modify: `apps/portal/app/api/twilio/voice/incoming/route.ts`
- Modify: `apps/portal/tests/app/twilio/incoming.test.ts`

- [ ] **Step 1: Update the TwiML test**

In `apps/portal/tests/lib/voice/twiml.test.ts`, add `callId: "call-1"` to the shared `opts` object, and replace the two `<Client>` assertions:

The single-target test expectation becomes:
```ts
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        "<Response>" +
        "<Say>Connecting you to the front desk, one moment.</Say>" +
        '<Dial timeout="120" action="https://x.test/api/twilio/voice/dial-result" method="POST">' +
        '<Client><Identity>lc_a1</Identity><Parameter name="callId" value="call-1"/></Client>' +
        "</Dial>" +
        "</Response>",
    );
```
The multi-target test expectation becomes:
```ts
    expect(xml).toContain(
      '<Client><Identity>lc_a1</Identity><Parameter name="callId" value="call-1"/></Client>' +
        '<Client><Identity>lc_x1</Identity><Parameter name="callId" value="call-1"/></Client>',
    );
```
(The empty-targets→apology, not-in-service, escaping, and hangup tests are unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/twiml.test.ts`
Expected: FAIL — output still uses the old `<Client>lc_a1</Client>` form / `callId` missing from type.

- [ ] **Step 3: Update the builder**

In `apps/portal/lib/voice/twiml.ts`, add `callId` to the options interface:
```ts
export interface IncomingTwimlOpts {
  greeting: string;
  timeoutSeconds: number;
  actionUrl: string;
  apologyMessage: string;
  callId: string;
}
```
And replace the `clients` mapping inside `buildIncomingTwiml`:
```ts
  const clients = targets
    .map(
      (t) =>
        `<Client><Identity>${escapeXml(t.identity)}</Identity>` +
        `<Parameter name="callId" value="${escapeXml(opts.callId)}"/></Client>`,
    )
    .join("");
```
(Leave the empty-targets apology branch and everything else unchanged.)

- [ ] **Step 4: Run TwiML test to verify it passes**

Run: `pnpm test tests/lib/voice/twiml.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the incoming route to supply `callId`**

In `apps/portal/app/api/twilio/voice/incoming/route.ts`, replace the call-record insert block (step "5. Record the call") so it captures an id, and pass it into the builder.

Replace:
```ts
  // 5. Record the call (idempotent on CallSid).
  if (!existing) {
    await admin.from("calls").insert({
      operator_id: property.operator_id,
      property_id: property.id,
      channel: "AUDIO",
      state: targets.length === 0 ? "NO_ANSWER" : "RINGING",
      twilio_call_sid: callSid,
      caller_number: from,
    });
  }
```
with:
```ts
  // 5. Record the call (idempotent on CallSid); capture its id for the TwiML callId.
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
```
Then add `callId` to the `buildIncomingTwiml` options:
```ts
  return twimlResponse(
    buildIncomingTwiml(targets, {
      greeting: GREETING,
      timeoutSeconds: RING_TIMEOUT_SECONDS,
      actionUrl,
      apologyMessage: APOLOGY,
      callId,
    }),
  );
```

- [ ] **Step 6: Update the incoming route test mock**

In `apps/portal/tests/app/twilio/incoming.test.ts`, the mock's `insert` must now support `.select("id").single()`. Replace the builder's `insert` line:
```ts
      builder.insert = (row: unknown) => insertSpy(table, row);
```
with:
```ts
      builder.insert = (row: unknown) => {
        insertSpy(table, row);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: "call-1" }, error: null }),
          }),
        };
      };
```
And update the dial assertion in the "dials the assigned agent" test:
```ts
    expect(xml).toContain(
      '<Client><Identity>lc_a1</Identity><Parameter name="callId" value="call-1"/></Client>',
    );
```
(The idempotent test still asserts `insertSpy` was not called; the NO_ANSWER test still asserts the inserted row's `state`.)

- [ ] **Step 7: Run the incoming route test**

Run: `pnpm test tests/app/twilio/incoming.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/lib/voice/twiml.ts apps/portal/tests/lib/voice/twiml.test.ts "apps/portal/app/api/twilio/voice/incoming/route.ts" apps/portal/tests/app/twilio/incoming.test.ts
git commit -m "feat(5b): pass callId to the browser via TwiML <Client><Parameter>"
```

---

## Task 6: `/api/twilio/token` — browser access token

**Files:**
- Create: `apps/portal/lib/twilio/token.ts`
- Create: `apps/portal/app/api/twilio/token/route.ts`
- Test: `apps/portal/tests/app/twilio/token.test.ts`

- [ ] **Step 1: Write the token builder**

Create `apps/portal/lib/twilio/token.ts`:
```ts
import "server-only";

import twilio from "twilio";

export interface VoiceTokenArgs {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  identity: string;
  ttlSeconds: number;
}

/**
 * Mint a Twilio access token granting the browser the right to RECEIVE calls
 * to `identity`. Incoming-only in v1 (no outgoing application SID).
 */
export function buildVoiceAccessToken(args: VoiceTokenArgs): string {
  const { AccessToken } = twilio.jwt;
  const { VoiceGrant } = AccessToken;

  const token = new AccessToken(
    args.accountSid,
    args.apiKeySid,
    args.apiKeySecret,
    { identity: args.identity, ttl: args.ttlSeconds },
  );
  token.addGrant(new VoiceGrant({ incomingAllow: true }));
  return token.toJwt();
}
```

- [ ] **Step 2: Write the failing route test**

Create `apps/portal/tests/app/twilio/token.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({
      auth: { getUser: () => getUser() },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
      }),
    }),
}));

const buildVoiceAccessToken = vi.fn(() => "jwt-token");
vi.mock("@/lib/twilio/token", () => ({
  buildVoiceAccessToken: (...a: unknown[]) => buildVoiceAccessToken(...a),
}));

vi.mock("@/lib/twilio/config", () => ({
  getTwilioApiCredentials: () => ({
    accountSid: "AC1",
    apiKeySid: "SK1",
    apiKeySecret: "sec",
  }),
}));

import { GET } from "@/app/api/twilio/token/route";

beforeEach(() => {
  getUser.mockReset();
  maybeSingle.mockReset();
  buildVoiceAccessToken.mockClear();
});

describe("GET /api/twilio/token", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403 when the profile has no twilio_identity (e.g. OWNER)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: { id: "u1", role: "OWNER", twilio_identity: null },
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns a token + identity for a call-taker", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    maybeSingle.mockResolvedValue({
      data: { id: "u1", role: "AGENT", twilio_identity: "lc_u1" },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "jwt-token", identity: "lc_u1" });
    expect(buildVoiceAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ identity: "lc_u1", ttlSeconds: 3600 }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/app/twilio/token.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 4: Write the route**

Create `apps/portal/app/api/twilio/token/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { getTwilioApiCredentials } from "@/lib/twilio/config";
import { buildVoiceAccessToken } from "@/lib/twilio/token";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;

export async function GET(): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, twilio_identity")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.twilio_identity) {
    return NextResponse.json(
      { error: "Not a call-taker" },
      { status: 403 },
    );
  }

  const creds = getTwilioApiCredentials();
  const token = buildVoiceAccessToken({
    ...creds,
    identity: profile.twilio_identity,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });

  return NextResponse.json({ token, identity: profile.twilio_identity });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/app/twilio/token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/twilio/token.ts "apps/portal/app/api/twilio/token/route.ts" apps/portal/tests/app/twilio/token.test.ts
git commit -m "feat(5b): /api/twilio/token — incoming-only voice access token"
```

---

## Task 7: `/api/presence` — heartbeat + Ready/Away writes

**Files:**
- Create: `apps/portal/app/api/presence/route.ts`
- Test: `apps/portal/tests/app/presence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/presence.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update: (v: unknown) => updateSpy(v) }) }),
}));

import { POST } from "@/app/api/presence/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
});

describe("POST /api/presence", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ status: "AVAILABLE" }))).status).toBe(401);
  });

  it("400 on a non-live status (OFFLINE is cron-only)", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect((await POST(req({ status: "OFFLINE" }))).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("updates status + last_seen for the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(req({ status: "AWAY" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "AWAY" }),
    );
    const vals = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(vals).toHaveProperty("last_seen_at");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/presence.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/presence/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLiveStatus } from "@/lib/voice/presence";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !isLiveStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ status: body.status, last_seen_at: new Date().toISOString() })
    .eq("id", user.id);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/presence.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/presence/route.ts" apps/portal/tests/app/presence.test.ts
git commit -m "feat(5b): /api/presence — heartbeat + Ready/Away writes"
```

---

## Task 8: `/api/twilio/voice/answered` — answer transition

**Files:**
- Create: `apps/portal/app/api/twilio/voice/answered/route.ts`
- Test: `apps/portal/tests/app/twilio/answered.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/twilio/answered.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () =>
    Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

// admin client: calls.select(...).eq(...).maybeSingle() for the lookup;
// calls.update(...).eq(...).eq(...) and profiles.update(...).eq(...) for writes.
let callRow: { id: string; state: string; operator_id: string } | null = null;
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(async () => ({
  data: { id: "u1", operator_id: "op1" },
}));

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => {
            profileUpdateSpy(v);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // calls
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
        update: (v: unknown) => {
          callUpdateSpy(v);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      };
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));

import { POST } from "@/app/api/twilio/voice/answered/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/twilio/voice/answered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  callUpdateSpy.mockClear();
  profileUpdateSpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/twilio/voice/answered", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ callId: "c1" }))).status).toBe(401);
  });

  it("marks the call IN_PROGRESS + handled_by + answered_at, and self ON_CALL", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "op1" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(204);
    expect(callUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "IN_PROGRESS",
        handled_by_user_id: "u1",
      }),
    );
    expect(callUpdateSpy.mock.calls[0][0]).toHaveProperty("answered_at");
    expect(profileUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ON_CALL" }),
    );
  });

  it("409 + no write when the call is not RINGING (already answered)", async () => {
    callRow = { id: "c1", state: "IN_PROGRESS", operator_id: "op1" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(409);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("404 when the call belongs to another operator", async () => {
    callRow = { id: "c1", state: "RINGING", operator_id: "OTHER" };
    const res = await POST(req({ callId: "c1" }));
    expect(res.status).toBe(404);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/twilio/answered.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/twilio/voice/answered/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer } from "@/lib/voice/call-state";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { callId?: string };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
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

  const { data: call } = await admin
    .from("calls")
    .select("id, state, operator_id")
    .eq("id", body.callId)
    .maybeSingle();
  if (!call || call.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // Conditional on still-RINGING (second .eq) to lose the answer race safely.
  await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: user.id,
      answered_at: new Date().toISOString(),
    })
    .eq("id", body.callId)
    .eq("state", "RINGING");

  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", user.id);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/twilio/answered.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/twilio/voice/answered/route.ts" apps/portal/tests/app/twilio/answered.test.ts
git commit -m "feat(5b): /api/twilio/voice/answered — answer transition + ON_CALL"
```

---

## Task 9: `/api/calls/notes` — save room# + notes

**Files:**
- Create: `apps/portal/app/api/calls/notes/route.ts`
- Test: `apps/portal/tests/app/calls-notes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/calls-notes.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

const updateSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (v: unknown) => {
        updateSpy(v);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));

import { POST } from "@/app/api/calls/notes/route";

function req(body: unknown) {
  return new Request("http://localhost:3000/api/calls/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getUser.mockReset();
  updateSpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("POST /api/calls/notes", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req({ callId: "c1" }))).status).toBe(401);
  });

  it("400 without a callId", async () => {
    expect((await POST(req({ roomNumber: "204" }))).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("saves room_number + notes", async () => {
    const res = await POST(req({ callId: "c1", roomNumber: "204", notes: "lockout" }));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith({ room_number: "204", notes: "lockout" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/calls-notes.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/calls/notes/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    callId?: string;
    roomNumber?: string;
    notes?: string;
  };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Only the agent who handled the call may annotate it.
  await admin
    .from("calls")
    .update({ room_number: body.roomNumber ?? null, notes: body.notes ?? null })
    .eq("id", body.callId)
    .eq("handled_by_user_id", user.id);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/calls-notes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/calls/notes/route.ts" apps/portal/tests/app/calls-notes.test.ts
git commit -m "feat(5b): /api/calls/notes — save room# + notes"
```

---

## Task 10: `/api/cron/mark-stale-offline` + Vercel Cron schedule

**Files:**
- Create: `apps/portal/app/api/cron/mark-stale-offline/route.ts`
- Test: `apps/portal/tests/app/cron-offline.test.ts`
- Modify: `apps/portal/vercel.json` (add `crons`)
- Modify: `apps/portal/.env.example` (add `CRON_SECRET`)

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/cron-offline.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ltSpy = vi.fn(() => ({ neq: () => Promise.resolve({ error: null, count: 2 }) }));
const updateSpy = vi.fn(() => ({ lt: ltSpy }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ update: (v: unknown) => updateSpy(v) }) }),
}));

import { GET } from "@/app/api/cron/mark-stale-offline/route";

function req(auth?: string) {
  return new Request("http://localhost:3000/api/cron/mark-stale-offline", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  ltSpy.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/mark-stale-offline", () => {
  it("401 when CRON_SECRET is set but the header is wrong", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("sweeps stale rows to OFFLINE when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "OFFLINE" }),
    );
  });

  it("runs without auth when CRON_SECRET is unset (local/dev)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/cron-offline.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/cron/mark-stale-offline/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { STALE_AFTER_MS } from "@/lib/voice/presence";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({ status: "OFFLINE" })
    .lt("last_seen_at", cutoff)
    .neq("status", "OFFLINE");

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/cron-offline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Schedule the cron + document the secret**

In `apps/portal/vercel.json`, add a top-level `"crons"` key (merge — keep any existing keys like rewrites):
```json
{
  "crons": [
    { "path": "/api/cron/mark-stale-offline", "schedule": "* * * * *" }
  ]
}
```
Append to `apps/portal/.env.example`:
```bash
# Cron auth (Vercel sends "Authorization: Bearer $CRON_SECRET"). Optional locally.
CRON_SECRET=
```

- [ ] **Step 6: Commit**

```bash
git add "apps/portal/app/api/cron/mark-stale-offline/route.ts" apps/portal/tests/app/cron-offline.test.ts apps/portal/vercel.json apps/portal/.env.example
git commit -m "feat(5b): OFFLINE sweep cron + every-minute Vercel schedule"
```

---

## Task 11: Softphone client component

**Context:** One `"use client"` component, used by both portals. It owns: token fetch + Device registration, the presence heartbeat, the Ready/Away switch (agents only), the incoming banner, in-call controls, and room#/notes. The Twilio Device touches browser-only APIs, so the SDK is **dynamically imported inside `useEffect`** (never at module top — that would crash SSR). There is no unit test for the Device-bound component; its pure logic already lives in tested `lib/voice/*`, and Task 13 covers it with a real two-browser smoke.

**Files:**
- Create: `apps/portal/components/softphone/softphone.tsx`

- [ ] **Step 1: Write the component**

Create `apps/portal/components/softphone/softphone.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";

import type { PresenceStatus } from "@/lib/voice/presence";

type Phase = "connecting" | "ready" | "incoming" | "in-call" | "error";

interface SoftphoneProps {
  readonly role: "AGENT" | "ADMIN";
}

const HEARTBEAT_MS = 20_000;

async function postPresence(status: PresenceStatus): Promise<void> {
  await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

export function Softphone({ role }: SoftphoneProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [ready, setReady] = useState(true); // login defaults to AVAILABLE
  const [muted, setMuted] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deviceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callRef = useRef<any>(null);
  const callIdRef = useRef<string>("");
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Current intended presence, derived from local UI state.
  const intendedStatus = useCallback((): PresenceStatus => {
    if (phase === "in-call") return "ON_CALL";
    return readyRef.current ? "AVAILABLE" : "AWAY";
  }, [phase]);

  // Register the Twilio Device once.
  useEffect(() => {
    let cancelled = false;
    let device: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    (async () => {
      try {
        const res = await fetch("/api/twilio/token");
        if (!res.ok) throw new Error("token");
        const { token } = (await res.json()) as { token: string };

        const { Device } = await import("@twilio/voice-sdk");
        device = new Device(token, { closeProtection: true });
        deviceRef.current = device;

        device.on("registered", () => {
          if (!cancelled) setPhase("ready");
        });
        device.on("error", () => {
          if (!cancelled) setPhase("error");
        });
        device.on("incoming", (call: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          callRef.current = call;
          callIdRef.current = call.customParameters?.get("callId") ?? "";
          if (!cancelled) setPhase("incoming");
          call.on("disconnect", () => {
            void endCall();
          });
          call.on("cancel", () => {
            callRef.current = null;
            if (!cancelled) setPhase("ready");
          });
        });

        await device.register();
        await postPresence("AVAILABLE");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        device?.destroy();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat: keep last_seen + status fresh while mounted.
  useEffect(() => {
    const id = setInterval(() => {
      void postPresence(intendedStatus());
    }, HEARTBEAT_MS);
    const onFocus = () => void postPresence(intendedStatus());
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [intendedStatus]);

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    call.accept();
    setMuted(false);
    setPhase("in-call");
    await fetch("/api/twilio/voice/answered", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId: callIdRef.current }),
    }).catch(() => {});
  }, []);

  const declineCall = useCallback(() => {
    callRef.current?.reject();
    callRef.current = null;
    setPhase("ready");
  }, []);

  const endCall = useCallback(async () => {
    const id = callIdRef.current;
    try {
      callRef.current?.disconnect();
    } catch {
      // ignore
    }
    callRef.current = null;
    if (id && (roomNumber || notes)) {
      await fetch("/api/calls/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: id, roomNumber, notes }),
      }).catch(() => {});
    }
    setRoomNumber("");
    setNotes("");
    setMuted(false);
    setPhase("ready");
    await postPresence(readyRef.current ? "AVAILABLE" : "AWAY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomNumber, notes]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    callRef.current?.mute(next);
    setMuted(next);
  }, [muted]);

  const toggleReady = useCallback(() => {
    const next = !ready;
    setReady(next);
    void postPresence(next ? "AVAILABLE" : "AWAY");
  }, [ready]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">Softphone</span>
        <ConnectionDot phase={phase} />
      </div>

      {role === "AGENT" && phase !== "in-call" && phase !== "incoming" && (
        <button
          type="button"
          onClick={toggleReady}
          className="mt-3 w-full rounded-md border border-border px-3 py-2 text-foreground"
        >
          {ready ? "Ready — accepting calls" : "Away — not accepting"}
        </button>
      )}

      {phase === "incoming" && (
        <div className="mt-3 space-y-2">
          <p className="text-text-muted">Incoming call…</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void acceptCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground"
            >
              <Phone size={16} /> Accept
            </button>
            <button
              type="button"
              onClick={declineCall}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-foreground"
            >
              <PhoneOff size={16} /> Decline
            </button>
          </div>
        </div>
      )}

      {phase === "in-call" && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleMute}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-foreground"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void endCall()}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2 text-destructive-foreground"
            >
              <PhoneOff size={16} /> Hang up
            </button>
          </div>
          <input
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            placeholder="Room #"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Call notes"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground"
          />
        </div>
      )}

      {phase === "error" && (
        <p className="mt-3 text-text-muted">
          Phone line disconnected — reload to reconnect.
        </p>
      )}
    </div>
  );
}

function ConnectionDot({ phase }: { readonly phase: Phase }) {
  const ok = phase === "ready" || phase === "incoming" || phase === "in-call";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? "bg-primary" : "bg-text-muted"
      }`}
      aria-label={ok ? "connected" : "disconnected"}
    />
  );
}
```

- [ ] **Step 2: Typecheck + lint the component**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. If lint flags the `any` device/call refs, the inline `eslint-disable` comments cover them; adjust only if a different rule fires. If a Tailwind token class above (`bg-destructive`, `text-primary-foreground`, etc.) isn't defined in `app/globals.css`, swap it for an existing token (check the file) — do **not** hardcode a hex.

- [ ] **Step 3: Commit**

```bash
git add apps/portal/components/softphone/softphone.tsx
git commit -m "feat(5b): shared softphone client component"
```

---

## Task 12: Agent shell + dashboard, mount softphone in both portals

**Files:**
- Modify: `apps/portal/app/(agent)/layout.tsx`
- Modify: `apps/portal/app/(agent)/agent/page.tsx`
- Modify: `apps/portal/app/(admin)/layout.tsx`

- [ ] **Step 1: Agent layout — header shell + mount the softphone**

Replace `apps/portal/app/(agent)/layout.tsx` with:
```tsx
import { requireRole } from "@/lib/auth/require-role";
import { Softphone } from "@/components/softphone/softphone";

export default async function AgentLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  await requireRole("AGENT"); // returns RequiredProfile {id, role, operator_id, active} — guards only

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <span className="font-semibold text-foreground">Lobby Connect</span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-sm text-text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <main>{children}</main>
        <aside>
          <Softphone role="AGENT" />
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Agent dashboard page — in-call two-region layout**

Replace `apps/portal/app/(agent)/agent/page.tsx` with:
```tsx
export default function AgentDashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Front desk</h1>
      {/*
        Two-region in-call area. Left = call context/notes (driven by the
        softphone in the sidebar today). Right = reserved for Plan 6's video
        feed + playbook panel — intentionally empty in v1 so adding video is a
        fill-in, not a repaint.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-text-muted">
            Calls ring the softphone in the sidebar. Accept to connect.
          </p>
        </section>
        <section
          className="rounded-lg border border-dashed border-border p-6"
          aria-label="Video + playbook (Plan 6)"
        >
          <p className="text-sm text-text-muted">
            Video &amp; playbook appear here during lobby calls.
          </p>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount the softphone in the admin shell**

Open `apps/portal/app/(admin)/layout.tsx` (the admin shell — it renders the sidebar via `@/components/app-sidebar` + `@/components/user-menu` around `{children}`). Add the import at the top:
```tsx
import { Softphone } from "@/components/softphone/softphone";
```
Then render `<Softphone role="ADMIN" />` inside the persistent shell chrome so it stays mounted across admin page navigations — place it in the layout's own markup (e.g., in the sidebar footer or the header region), **not** inside `{children}` (which remounts per page and would drop an active call). Example placement near the header/sidebar:
```tsx
        <Softphone role="ADMIN" />
```
Read the current layout first to choose a spot that keeps the existing grid/sidebar intact; the widget is self-contained and ~320px-friendly.

- [ ] **Step 4: Typecheck, lint, build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. (`build` confirms the dynamic `@twilio/voice-sdk` import doesn't break SSR and the client/server boundary is clean.)

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(agent)/layout.tsx" "apps/portal/app/(agent)/agent/page.tsx" "apps/portal/app/(admin)/layout.tsx"
git commit -m "feat(5b): agent shell + dashboard + softphone mounted in both portals"
```

---

## Task 13: Full suite + gates + live two-browser smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite + gates**

Run (from `apps/portal/`):
```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```
Expected: all green. New suites: `config` (extended), `presence`, `call-state`, `token`, `presence` route, `answered`, `calls-notes`, `cron-offline`, plus the updated `twiml` + `incoming`.

- [ ] **Step 2: Start local stack + tunnel**

```bash
supabase start
supabase db reset           # applies 0006 + seeds twilio identities
cd apps/portal && pnpm dev  # :3000
```
Second terminal:
```bash
cloudflared tunnel --url http://localhost:3000
```
Point the Twilio number's Voice webhooks at `https://<tunnel>/api/twilio/voice/incoming` (POST) and `/status` (POST), per `docs/setup/2026-05-30-twilio-voice-setup.md`.

- [ ] **Step 3: Register a softphone**

Sign in as the seeded agent (`alex.agent@lobbyconnect.local` / `localdev123`) at `http://localhost:3000`. Grant microphone permission. Confirm the softphone dot goes connected (Ready) and a `profiles` row shows `status='AVAILABLE'`:
```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "select full_name, status, last_seen_at from profiles where role='AGENT';"
```

- [ ] **Step 4: Place a real call**

Call `+14058750410` from a phone. Expected: the browser shows the incoming banner + rings → click **Accept** → two-way audio. Verify the record:
```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "select state, handled_by_user_id, answered_at from calls order by created_at desc limit 1;"
```
Expected: `state='IN_PROGRESS'`, `handled_by_user_id` = the agent, `answered_at` set. Type a room # + notes, then hang up. Confirm `state` finalizes (`COMPLETED`), `duration_seconds`/`ended_at` populate (5a webhooks), and `room_number`/`notes` saved.

- [ ] **Step 5: Verify presence sweep**

Close the agent tab. Hit the cron route manually (simulating Vercel):
```bash
curl -s http://localhost:3000/api/cron/mark-stale-offline
```
Wait past the 90s window, call it again, then confirm the agent flipped to `OFFLINE` in `profiles`. (Locally `CRON_SECRET` is unset, so no auth header is needed.)

- [ ] **Step 6: Fix any failures, re-run until clean.**

---

## Task 14: Tag the milestone

**Files:** none

- [ ] **Step 1: Confirm clean tree + tag**

```bash
git status            # clean
git tag plan-05b-agent-softphone-complete
```
Per standing policy, **do not push** — migrations 0001–0006 stay local-only and the repo stays unpushed.

- [ ] **Step 2: Update project status memory**

Update `project-status.md`: 5b complete, tag name, next = Plan 6 (Kiosk + agent video split-screen + playbook; prereq Agora account/creds).

---

## Self-Review Notes (author)

- **Spec coverage:** agent shell (T12), shared softphone both portals (T11–T12), token route incoming-only (T6), presence AWAY + heartbeat + cron (T2, T3, T7, T10), answer transition `handled_by`/`answered_at`/IN_PROGRESS + ON_CALL (T8), room#/notes (T9), callId TwiML seam (T5), in-call two-region reserved layout (T12), desktop-first / mobile non-goal (no mobile work, satisfied by omission), migration 0006 (T2), roadmap reorder (recorded in spec + CLAUDE.md). All spec sections map to a task.
- **Ownership split with 5a:** T8 sets only IN_PROGRESS/answered_at/handled_by; finalization (terminal state, duration, ended_at) stays in 5a's `/dial-result` + `/status` — untouched. T5 is the only 5a edit (additive TwiML param) and updates the two affected 5a tests.
- **Write-path correctness:** presence/answer/notes write `profiles`/`calls` via the **service-role** client after verifying the session (profile self-update is name/password-only; `calls` is service-role-write-only). Token route uses the **user-scoped** client (read own profile).
- **Type consistency:** `PresenceStatus` (T3) reused in T7 (`isLiveStatus`) + T11; `canAnswer` (T4) reused in T8; `buildVoiceAccessToken` args (T6) match the route call; `IncomingTwimlOpts.callId` (T5) matches the incoming route. `Softphone` prop `role` is `"AGENT" | "ADMIN"` everywhere it's mounted.
- **SSR safety:** `@twilio/voice-sdk` is dynamically imported inside `useEffect` (T11), never at module scope.
- **Mock caveat:** route tests stub the Supabase chain by shape; if a route's query chain changes, update its mock (noted in 5a; same applies here — esp. T5's insert `.select().single()` and T8's nested `.eq().eq()`).
- **Manual-only surface:** the Device-bound component has no unit test by design; its pure logic is in tested `lib/voice/*` and the real path is covered by the T13 two-browser smoke.
