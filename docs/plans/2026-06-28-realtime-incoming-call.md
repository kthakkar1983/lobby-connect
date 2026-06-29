# Realtime incoming-call signaling (video) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3s `/api/calls/incoming-video` poll with a Supabase Realtime broadcast-ping + refetch signal, so video calls ring agents via push (~1–2s) and incoming-call DB/compute load scales with actual calls, not idle fleet time.

**Architecture:** A content-free `calls-changed` event is broadcast on a private per-operator channel (`operator:{id}:calls`) from the four server routes that change a video call's RINGING-relevance. The agent's `IncomingVideoBanner` subscribes (authenticated browser Supabase client) and, on each event / on (re)subscribe, refetches the existing authoritative `/api/calls/incoming-video` route. A 60s safety-net poll + focus-refetch + resubscribe-on-error guard against a dead socket. Channel auth is RLS on `realtime.messages`, operator-scoped.

**Tech Stack:** Next.js App Router (portal), `@supabase/ssr` (browser client), `@supabase/supabase-js` Realtime, Supabase HTTP broadcast endpoint, Vitest (node + jsdom configs), `@sentry/nextjs`.

**Spec:** `docs/specs/2026-06-28-realtime-incoming-call-design.md`

---

## Context the implementer needs

- **Two Vitest configs.** `vitest.config.ts` (env `node`) runs `tests/**/*.test.{ts,tsx}` **except** `tests/components/**`. `vitest.jsdom.config.ts` (env `jsdom`, React plugin) runs `tests/components/**/*.test.tsx`. `pnpm test` runs both. → Pure-logic tests go under `tests/lib/...`; the client-component banner test goes under `tests/components/...`.
- **`@/lib/env` cannot be imported from client code.** It calls `required("SUPABASE_SERVICE_ROLE_KEY", …)` at module load, which throws in a browser bundle (the var is server-only). The browser Supabase client must read `process.env.NEXT_PUBLIC_*` directly (Next inlines these at build).
- **`server-only` import** is aliased to a no-op in both Vitest configs, so a `server-only` module is testable — but never import a `server-only` module into a client component.
- **Sentry** is imported as `import * as Sentry from "@sentry/nextjs"`.
- **`requireApiActor` returns `actor.operatorId`** (camelCase) for AGENT/ADMIN routes; the kiosk routes derive operator from the call/property row instead.
- Run all commands from `apps/portal/` unless noted. Test a single file with `pnpm vitest run <path>` (node) or `pnpm vitest run --config vitest.jsdom.config.ts <path>` (jsdom).

## File structure

**Create**
- `apps/portal/lib/realtime/calls-channel.ts` — isomorphic: `operatorCallsChannelTopic(operatorId)` + `CALLS_CHANGED_EVENT` const. No `server-only` (client imports it).
- `apps/portal/lib/realtime/broadcast.ts` — `server-only`: `broadcastCallsChanged(operatorId)` (HTTP broadcast, best-effort).
- `apps/portal/lib/supabase/browser.ts` — authenticated browser client (`createBrowserClient`).
- `apps/portal/tests/lib/realtime/calls-channel.test.ts`
- `apps/portal/tests/lib/realtime/broadcast.test.ts`
- `apps/portal/tests/components/incoming-video-banner.test.tsx`
- `supabase/migrations/0018_realtime_calls_authz.sql`

**Modify**
- `packages/shared/src/protocol.ts` (+ `packages/shared/tests/protocol.test.ts`) — add `INCOMING_VIDEO_FALLBACK_POLL_MS`.
- `apps/portal/app/api/kiosk/call-started/route.ts` (+ test) — broadcast after insert.
- `apps/portal/app/api/calls/[id]/answer-video/route.ts` (+ test) — broadcast after claim.
- `apps/portal/app/api/calls/[id]/end-video/route.ts` (+ test) — broadcast after finalize.
- `apps/portal/app/api/kiosk/call-ended/route.ts` (+ test) — add `operator_id` to select; broadcast after finalize.
- `apps/portal/components/video-call/incoming-video-banner.tsx` — Realtime subscription; `operatorId` prop.
- `apps/portal/components/video-call/video-call-host.tsx` — thread `operatorId`.
- `apps/portal/components/dashboard-workspace.tsx` — thread `operatorId`.
- `apps/portal/components/app-shell.tsx` — thread `operatorId`.
- `apps/portal/app/(agent)/layout.tsx` + `apps/portal/app/(admin)/layout.tsx` — pass `operatorId={actor.operator_id}`.

---

## Task 1: Channel topic + event constant (isomorphic)

**Files:**
- Create: `apps/portal/lib/realtime/calls-channel.ts`
- Test: `apps/portal/tests/lib/realtime/calls-channel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/realtime/calls-channel.test.ts
import { describe, it, expect } from "vitest";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";

describe("operatorCallsChannelTopic", () => {
  it("builds a per-operator calls topic", () => {
    expect(operatorCallsChannelTopic("op-123")).toBe("operator:op-123:calls");
  });

  it("places the operator id as the second colon segment (RLS parses split_part(topic, ':', 2))", () => {
    const topic = operatorCallsChannelTopic("abc-def");
    expect(topic.split(":")[1]).toBe("abc-def");
  });
});

describe("CALLS_CHANGED_EVENT", () => {
  it("is the stable event name shared by publisher and subscriber", () => {
    expect(CALLS_CHANGED_EVENT).toBe("calls-changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/realtime/calls-channel.test.ts`
Expected: FAIL — cannot resolve `@/lib/realtime/calls-channel`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/portal/lib/realtime/calls-channel.ts
// Isomorphic (client + server): the topic + event name shared by the broadcast
// publisher (server) and the IncomingVideoBanner subscriber (client). NO
// `server-only` here — the client imports it.

/** Broadcast event carrying a content-free "refetch your calls" nudge. */
export const CALLS_CHANGED_EVENT = "calls-changed";

/**
 * Private Realtime channel topic for one operator's call-change nudges. The
 * operator id is the second colon segment so the `realtime.messages` RLS policy
 * can authorize via `split_part(realtime.topic(), ':', 2)::uuid`. The decision-#6
 * multi-tenant seam: one operator in v1, correct for many.
 */
export function operatorCallsChannelTopic(operatorId: string): string {
  return `operator:${operatorId}:calls`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/realtime/calls-channel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/realtime/calls-channel.ts apps/portal/tests/lib/realtime/calls-channel.test.ts
git commit -m "feat(realtime): per-operator calls channel topic + event constant"
```

---

## Task 2: Server broadcast helper

**Files:**
- Create: `apps/portal/lib/realtime/broadcast.ts`
- Test: `apps/portal/tests/lib/realtime/broadcast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/realtime/broadcast.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  },
}));

const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
}));

import { broadcastCallsChanged } from "@/lib/realtime/broadcast";

beforeEach(() => {
  captureException.mockClear();
  captureMessage.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("broadcastCallsChanged", () => {
  it("POSTs a calls-changed message to the Realtime broadcast endpoint with the service key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal("fetch", fetchMock);

    await broadcastCallsChanged("op-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-key");
    expect(init.headers.Authorization).toBe("Bearer service-key");
    expect(JSON.parse(init.body)).toEqual({
      messages: [{ topic: "operator:op-1:calls", event: "calls-changed", payload: {} }],
    });
  });

  it("swallows a non-2xx response and reports it (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(broadcastCallsChanged("op-1")).resolves.toBeUndefined();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("swallows a thrown fetch error and reports it (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(broadcastCallsChanged("op-1")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/realtime/broadcast.test.ts`
Expected: FAIL — cannot resolve `@/lib/realtime/broadcast`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/portal/lib/realtime/broadcast.ts
import "server-only";
import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/env";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";

/**
 * Fire a content-free "calls-changed" nudge to the operator's private Realtime
 * channel so agent tabs refetch the incoming-video list. Stateless: one HTTP
 * POST to Supabase's broadcast endpoint (no held socket from the function).
 *
 * Best-effort by contract: a non-2xx or a thrown error is swallowed + reported,
 * NEVER re-thrown, so a Realtime hiccup can't fail or delay the call path. The
 * 60s safety-net poll in IncomingVideoBanner is the delivery guarantee.
 */
export async function broadcastCallsChanged(operatorId: string): Promise<void> {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: operatorCallsChannelTopic(operatorId),
            event: CALLS_CHANGED_EVENT,
            payload: {},
          },
        ],
      }),
    });
    if (!res.ok) {
      Sentry.captureMessage(`broadcastCallsChanged non-2xx: ${res.status}`);
    }
  } catch (err) {
    Sentry.captureException(err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/realtime/broadcast.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/realtime/broadcast.ts apps/portal/tests/lib/realtime/broadcast.test.ts
git commit -m "feat(realtime): best-effort broadcastCallsChanged HTTP helper"
```

---

## Task 3: Authenticated browser Supabase client

**Files:**
- Create: `apps/portal/lib/supabase/browser.ts`
- Test: `apps/portal/tests/lib/realtime/browser-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/portal/tests/lib/realtime/browser-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createBrowserClient = vi.fn(() => ({ realtime: {}, channel: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...a: unknown[]) => createBrowserClient(...a),
}));

beforeEach(() => {
  createBrowserClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("createBrowserSupabaseClient", () => {
  it("constructs a browser client from the public env (never the service key)", async () => {
    const { createBrowserSupabaseClient } = await import("@/lib/supabase/browser");
    createBrowserSupabaseClient();
    expect(createBrowserClient).toHaveBeenCalledWith("https://proj.supabase.co", "anon-key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/realtime/browser-client.test.ts`
Expected: FAIL — cannot resolve `@/lib/supabase/browser`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/portal/lib/supabase/browser.ts
"use client";
// Authenticated browser Supabase client, used for the Realtime subscription in
// IncomingVideoBanner. Reads the @supabase/ssr cookie session so the websocket
// carries the agent JWT (required for private-channel RLS).
//
// Deliberately does NOT import `@/lib/env`: that module validates
// SUPABASE_SERVICE_ROLE_KEY at load and would throw in the browser bundle. The
// NEXT_PUBLIC_* vars are inlined by Next at build, so read process.env directly.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@lc/shared";

export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/realtime/browser-client.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/supabase/browser.ts apps/portal/tests/lib/realtime/browser-client.test.ts
git commit -m "feat(supabase): authenticated browser client for Realtime"
```

---

## Task 4: Fallback-poll timing constant

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Test: `packages/shared/tests/protocol.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe block)

```ts
// packages/shared/tests/protocol.test.ts — add these imports + test
import { INCOMING_VIDEO_FALLBACK_POLL_MS } from "../src/protocol";

it("incoming-video fallback poll is a slow safety net (much slower than the old 3s poll)", () => {
  expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBe(60_000);
  // Must stay well above the old 3s poll so it's only a backstop, not the primary path.
  expect(INCOMING_VIDEO_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
});
```

(If `protocol.test.ts` imports specific names, add `INCOMING_VIDEO_FALLBACK_POLL_MS` to that import list instead of a second import line.)

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root): `pnpm -F @lc/shared test`
Expected: FAIL — `INCOMING_VIDEO_FALLBACK_POLL_MS` is undefined.

- [ ] **Step 3: Add the constant** to `packages/shared/src/protocol.ts` (after `PRESENCE_STALE_AFTER_MS`)

```ts
/**
 * Safety-net cadence for the agent's incoming-video banner. Realtime push is the
 * primary signal (~1s ring); this slow poll only backstops a silently-dead
 * subscription. 60s is 20x cheaper than the retired 3s poll while push covers
 * real latency. Tunable: raise, or drop to 0 (pure push), once Realtime is proven.
 */
export const INCOMING_VIDEO_FALLBACK_POLL_MS = 60_000;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root): `pnpm -F @lc/shared test`
Expected: PASS.

- [ ] **Step 5: Rebuild shared types + verify portal sees the export**

Run (from repo root): `pnpm -F @lc/shared build`
Expected: builds clean (the portal imports `INCOMING_VIDEO_FALLBACK_POLL_MS` from `@lc/shared` in Task 6).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/protocol.ts packages/shared/tests/protocol.test.ts
git commit -m "feat(shared): INCOMING_VIDEO_FALLBACK_POLL_MS (60s safety-net cadence)"
```

---

## Task 5: Wire the four publisher routes

Each route fires `void broadcastCallsChanged(operatorId)` after its successful DB write. `broadcastCallsChanged` already swallows all errors, so `void` (fire-and-forget) is safe and never affects the response. Do these one at a time, test each.

**Files:**
- Modify: `apps/portal/app/api/kiosk/call-started/route.ts` (+ `tests/app/kiosk/call-started.test.ts`)
- Modify: `apps/portal/app/api/calls/[id]/answer-video/route.ts` (+ `tests/app/calls/answer-video.test.ts`)
- Modify: `apps/portal/app/api/calls/[id]/end-video/route.ts` (+ `tests/app/calls/end-video.test.ts`)
- Modify: `apps/portal/app/api/kiosk/call-ended/route.ts` (+ `tests/app/kiosk/call-ended.test.ts`)

### 5a — call-started (kiosk)

- [ ] **Step 1: Add the broadcast mock + assertion to `tests/app/kiosk/call-started.test.ts`**

At the top with the other `vi.mock` calls:

```ts
const broadcastCallsChanged = vi.fn();
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastCallsChanged: (...a: unknown[]) => broadcastCallsChanged(...a),
}));
```

Add a test in the success path (reuse the existing happy-path setup that returns an active property and a successful insert):

```ts
it("broadcasts calls-changed for the property's operator after inserting the RINGING row", async () => {
  // ...existing happy-path arrange (active property w/ operator_id, insert returns an id)...
  const res = await POST(makeRequest()); // mirror the existing success test's request
  expect(res.status).toBe(200);
  expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1"); // the seeded property.operator_id
});
```

Match the operator id and request helper to whatever the existing success test uses.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/app/kiosk/call-started.test.ts`
Expected: FAIL — `broadcastCallsChanged` not called.

- [ ] **Step 3: Wire the route.** In `apps/portal/app/api/kiosk/call-started/route.ts`, add the import and the call after the successful insert (just before building `payload`):

```ts
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
```
```ts
  // Nudge agent tabs to refetch — the ring starts via Realtime push, not the poll.
  void broadcastCallsChanged(property.operator_id);

  const payload: CallStartResult = { callId: inserted.id, channelName };
  return NextResponse.json(payload);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/app/kiosk/call-started.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/call-started/route.ts apps/portal/tests/app/kiosk/call-started.test.ts
git commit -m "feat(voice): broadcast calls-changed on kiosk call-started"
```

### 5b — answer-video

- [ ] **Step 1: Add the same broadcast mock to `tests/app/calls/answer-video.test.ts`** (the `vi.mock("@/lib/realtime/broadcast", …)` block above) and a success-path assertion:

```ts
it("broadcasts calls-changed for the operator after claiming the call", async () => {
  // ...existing successful-claim arrange (actor with operatorId "op-1", call IN_PROGRESS claim succeeds)...
  const res = await POST(makeRequest(), makeCtx("call-1"));
  expect(res.status).toBe(200);
  expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/app/calls/answer-video.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the route.** In `apps/portal/app/api/calls/[id]/answer-video/route.ts`, add the import and fire after the claim succeeds (after the `profiles … ON_CALL` update, before the success response):

```ts
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
```
```ts
  // The claim removes this call from every other agent's incoming list.
  void broadcastCallsChanged(actor.operatorId);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/app/calls/answer-video.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/calls/[id]/answer-video/route.ts apps/portal/tests/app/calls/answer-video.test.ts
git commit -m "feat(voice): broadcast calls-changed on answer-video claim"
```

### 5c — end-video

- [ ] **Step 1: Add the broadcast mock to `tests/app/calls/end-video.test.ts`** and a success-path assertion:

```ts
it("broadcasts calls-changed for the operator after finalizing the call", async () => {
  // ...existing successful-finalize arrange (actor operatorId "op-1", state guard hits)...
  const res = await POST(makeRequest(), makeCtx("call-1"));
  expect(res.status).toBe(200);
  expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/app/calls/end-video.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the route.** In `apps/portal/app/api/calls/[id]/end-video/route.ts`, add the import and fire after the finalize update (before the success response):

```ts
import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
```
```ts
  // Clear the banner on any other tab still showing this call.
  void broadcastCallsChanged(actor.operatorId);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/app/calls/end-video.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/calls/[id]/end-video/route.ts apps/portal/tests/app/calls/end-video.test.ts
git commit -m "feat(voice): broadcast calls-changed on end-video finalize"
```

### 5d — call-ended (kiosk) — needs operator_id added to the select

- [ ] **Step 1: Add the broadcast mock to `tests/app/kiosk/call-ended.test.ts`**, ensure the mocked `calls` select row includes `operator_id: "op-1"`, and assert:

```ts
it("broadcasts calls-changed for the call's operator after finalizing", async () => {
  // ...existing successful-finalize arrange; the selected call row now also has operator_id: "op-1"...
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(broadcastCallsChanged).toHaveBeenCalledWith("op-1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/app/kiosk/call-ended.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the route.** In `apps/portal/app/api/kiosk/call-ended/route.ts`:
  1. Add `operator_id` to the call select:
     ```ts
     .select("id, property_id, state, answered_at, operator_id")
     ```
  2. Add the import:
     ```ts
     import { broadcastCallsChanged } from "@/lib/realtime/broadcast";
     ```
  3. Fire after the finalize update (before the success response):
     ```ts
     void broadcastCallsChanged(call.operator_id);
     ```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/app/kiosk/call-ended.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/call-ended/route.ts apps/portal/tests/app/kiosk/call-ended.test.ts
git commit -m "feat(voice): broadcast calls-changed on kiosk call-ended"
```

---

## Task 6: Subscriber — Realtime banner

Replace the 3s poll in `IncomingVideoBanner` with: subscribe to the operator channel, refetch on event / subscribe / reconnect, 60s fallback poll, resubscribe-on-error. The ringtone / tab-title / accept UI are unchanged.

**Files:**
- Modify: `apps/portal/components/video-call/incoming-video-banner.tsx`
- Test: `apps/portal/tests/components/incoming-video-banner.test.tsx`

- [ ] **Step 1: Write the failing test** (jsdom config)

```tsx
// apps/portal/tests/components/incoming-video-banner.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";

// --- mock the Realtime channel + browser client ---
const channel = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  let statusCb: ((status: string) => void) | undefined;
  return {
    handlers,
    getStatusCb: () => statusCb,
    on: vi.fn(function (this: unknown, _type: string, opts: { event: string }, cb: (p: unknown) => void) {
      handlers[opts.event] = cb;
      return this;
    }),
    subscribe: vi.fn(function (this: unknown, cb: (status: string) => void) {
      statusCb = cb;
      return this;
    }),
  };
});
const removeChannel = vi.fn();
const setAuth = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    realtime: { setAuth: () => setAuth() },
    channel: () => channel,
    removeChannel: () => removeChannel(),
  }),
}));

// Ringtone is irrelevant here — stub it so jsdom's missing Audio doesn't matter.
vi.mock("@/lib/video/ringtone", () => ({
  createRingtone: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("@/lib/video/audio-unlock", () => ({ unlockAudioPlayback: vi.fn() }));

import { IncomingVideoBanner } from "@/components/video-call/incoming-video-banner";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ calls: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  channel.on.mockClear();
  channel.subscribe.mockClear();
  removeChannel.mockClear();
  setAuth.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("IncomingVideoBanner Realtime", () => {
  it("subscribes to the operator's private channel and authenticates", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    expect(setAuth).toHaveBeenCalled();
    expect(channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "calls-changed" },
      expect.any(Function),
    );
  });

  it("refetches on a calls-changed broadcast and rings", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.on).toHaveBeenCalled());
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ calls: [{ id: "c1", channelName: "ch", propertyName: "The Hotel" }] }),
    });
    await act(async () => {
      channel.handlers["calls-changed"]({});
    });
    expect(await screen.findByText("The Hotel")).toBeTruthy();
  });

  it("refetches once on SUBSCRIBED (reconnect catch-up)", async () => {
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    await waitFor(() => expect(channel.subscribe).toHaveBeenCalled());
    fetchMock.mockClear();
    await act(async () => {
      channel.getStatusCb()?.("SUBSCRIBED");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resubscribes after a channel error", async () => {
    vi.useFakeTimers();
    render(<IncomingVideoBanner operatorId="op-1" onAccept={vi.fn()} />);
    channel.getStatusCb()?.("CHANNEL_ERROR");
    expect(removeChannel).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(channel.subscribe).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run --config vitest.jsdom.config.ts tests/components/incoming-video-banner.test.tsx`
Expected: FAIL — banner doesn't accept `operatorId` / doesn't subscribe yet.

- [ ] **Step 3: Rewrite the subscription effect.** In `apps/portal/components/video-call/incoming-video-banner.tsx`:

Update imports (add these; keep the existing ringtone / tab-title / audio-unlock / cn imports):
```tsx
import type { RealtimeChannel } from "@supabase/supabase-js";
import { INCOMING_VIDEO_FALLBACK_POLL_MS } from "@lc/shared";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { operatorCallsChannelTopic, CALLS_CHANGED_EVENT } from "@/lib/realtime/calls-channel";
```

Delete the `const POLL_MS = 3_000;` line and its comment.

Change the component signature to accept `operatorId`:
```tsx
export function IncomingVideoBanner({
  operatorId,
  onAccept,
}: {
  operatorId: string;
  onAccept: (call: IncomingVideoCall) => void;
}) {
```

Replace the **first** `useEffect` (the polling effect, currently lines ~25–46) with:
```tsx
  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;
    let resubscribeTimer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch("/api/calls/incoming-video");
        if (!res.ok) return;
        const body = (await res.json()) as { calls: IncomingVideoCall[] };
        if (active) setCalls(body.calls);
      } catch {
        /* ignore */
      }
    };

    const supabase = createBrowserSupabaseClient();
    // Attach the agent JWT so the private-channel RLS authorizes the subscribe.
    void supabase.realtime.setAuth();

    const subscribe = () => {
      channel = supabase
        .channel(operatorCallsChannelTopic(operatorId), { config: { private: true } })
        .on("broadcast", { event: CALLS_CHANGED_EVENT }, () => void tick())
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Catch up on (re)connect — the refetch is authoritative, so any
            // broadcast missed while disconnected is reconciled here.
            void tick();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Self-heal: drop the dead channel and resubscribe shortly.
            if (channel) void supabase.removeChannel(channel);
            channel = null;
            resubscribeTimer = setTimeout(subscribe, 1_000);
          }
        });
    };
    subscribe();

    // Initial load + slow safety-net poll + focus refetch. Realtime push is the
    // primary path; this 60s poll only backstops a silently-dead subscription.
    void tick();
    const pollId = setInterval(tick, INCOMING_VIDEO_FALLBACK_POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(pollId);
      if (resubscribeTimer) clearTimeout(resubscribeTimer);
      window.removeEventListener("focus", onFocus);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [operatorId]);
```

Leave the ringtone effect, the `useRingingTabTitle` call, and the entire JSX return unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run --config vitest.jsdom.config.ts tests/components/incoming-video-banner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/video-call/incoming-video-banner.tsx apps/portal/tests/components/incoming-video-banner.test.tsx
git commit -m "feat(video): Realtime push for incoming-video banner (replaces 3s poll)"
```

---

## Task 7: Thread operatorId from layout to banner

`IncomingVideoBanner` now requires `operatorId`. Pass it down the render chain: layout (has `actor.operator_id`) → `AppShell` → `DashboardWorkspace` → `VideoCallHost` → `IncomingVideoBanner`. This is a typecheck-driven task (no new test); a missing prop is a compile error.

**Files (modify):**
- `apps/portal/app/(agent)/layout.tsx`, `apps/portal/app/(admin)/layout.tsx`
- `apps/portal/components/app-shell.tsx`
- `apps/portal/components/dashboard-workspace.tsx`
- `apps/portal/components/video-call/video-call-host.tsx`

- [ ] **Step 1: Layouts** — pass `operatorId`:

`(agent)/layout.tsx`:
```tsx
    <AppShell role="AGENT" fullName={actor.full_name} email={actor.email} operatorId={actor.operator_id}>
```
`(admin)/layout.tsx`:
```tsx
    <AppShell role="ADMIN" fullName={profile.full_name} email={profile.email} operatorId={profile.operator_id}>
```

- [ ] **Step 2: `app-shell.tsx`** — add `operatorId` to props and forward it:

In the props type:
```tsx
  readonly email: string;
  readonly operatorId: string;
```
In the destructure: add `operatorId,`. On `<DashboardWorkspace …>` add:
```tsx
            operatorId={operatorId}
```

- [ ] **Step 3: `dashboard-workspace.tsx`** — add `operatorId` to props and forward it:

In the props type:
```tsx
  readonly email: string;
  readonly operatorId: string;
```
In the destructure: add `operatorId,`. Change the render to:
```tsx
          <VideoCallHost operatorId={operatorId} />
```

- [ ] **Step 4: `video-call-host.tsx`** — accept `operatorId` and pass it to the banner:

```tsx
export function VideoCallHost({ operatorId }: { operatorId: string }) {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);

  return (
    <>
      {!active && <IncomingVideoBanner operatorId={operatorId} onAccept={setActive} />}
      {active && <VideoCall callId={active.id} onClose={() => setActive(null)} propertyName={active.propertyName} />}
    </>
  );
}
```

- [ ] **Step 5: Typecheck the whole portal**

Run: `pnpm typecheck`
Expected: PASS — no missing-prop errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/portal/app/(agent)/layout.tsx" "apps/portal/app/(admin)/layout.tsx" apps/portal/components/app-shell.tsx apps/portal/components/dashboard-workspace.tsx apps/portal/components/video-call/video-call-host.tsx
git commit -m "feat(shell): thread operatorId to the incoming-video banner"
```

---

## Task 8: Channel authorization — migration 0018

Add the operator-scoped RLS policy on `realtime.messages` so an authenticated user may only read broadcasts on their own operator's channel.

**Files:**
- Create: `supabase/migrations/0018_realtime_calls_authz.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0018_realtime_calls_authz.sql
-- Authorize the per-operator calls broadcast channel (operator:{operatorId}:calls).
-- The push carries only a content-free "calls-changed" nudge, but we scope reads
-- to the caller's operator from day one — the decision-#6 multi-tenant seam.
--
-- The topic is `operator:<uuid>:calls`; split_part(...,':',2) is the operator id.
-- current_user_operator_id() is the existing SECURITY DEFINER helper (search_path
-- pinned), so it does not re-enter RLS.

create policy "operator members read operator calls channel"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and split_part((select realtime.topic()), ':', 1) = 'operator'
  and split_part((select realtime.topic()), ':', 2)::uuid = current_user_operator_id()
);
```

- [ ] **Step 2: Apply to prod via the Supabase MCP** (per CLAUDE.md, migrations are applied via MCP `apply_migration`, not `db push` — prod ref `ztunzdpmazwwwkxcpyfp`). Name it `0018_realtime_calls_authz`. Apply the same SQL.

Expected: success, no error. (If `realtime.messages` already has RLS enabled by Supabase — it is, by default — the policy just adds to it.)

- [ ] **Step 3: Disable "Allow public access" for Realtime** so private-channel RLS is enforced. This is a project setting (Supabase dashboard → Realtime → Settings → turn OFF "Allow public access"), not SQL. Confirm it is OFF on prod. Record that it was set. *(If it cannot be changed right now, the 60s fallback poll still rings calls — note it as a follow-up rather than blocking.)*

- [ ] **Step 4: Verify generated types are unaffected**

Run (from repo root, requires local Supabase per CLAUDE.md gen:types workflow, or skip if not set up and rely on CI): `pnpm gen:types:check`
Expected: PASS / no drift — an RLS policy does not change table types. If it reports drift unrelated to this change, stop and investigate.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0018_realtime_calls_authz.sql
git commit -m "feat(rls): operator-scoped authz for the calls broadcast channel"
```

---

## Task 9: Full verification

- [ ] **Step 1: Full test suite (both configs)**

Run (from `apps/portal/`): `pnpm test`
Expected: all portal tests green (node + jsdom). Run `pnpm -F @lc/shared test` from root too — shared green.

- [ ] **Step 2: Typecheck + lint + route guard**

Run (from repo root): `pnpm typecheck && pnpm lint && pnpm -F @lc/portal check:routes`
Expected: all PASS.

- [ ] **Step 3: Production build**

Run (from `apps/portal/`): `pnpm build`
Expected: build succeeds (catches client/server boundary issues — e.g. confirms `@/lib/supabase/browser` doesn't pull `@/lib/env` into the client bundle, and `@/lib/realtime/broadcast`'s `server-only` isn't imported by a client module).

- [ ] **Step 4: Commit any incidental fixes, then push the branch**

```bash
git push -u origin realtime-incoming-call
```

- [ ] **Step 5: Prod smoke (Realtime only works against the real Supabase project — deploy the branch to a Vercel preview or merge per the team's flow, then):**
  - [ ] Kiosk taps Call → agent banner rings in ~1–2s. In the agent tab's Network panel, confirm there is **no** 3s `incoming-video` cadence — only a ~60s backstop + the event-driven refetches.
  - [ ] Cancel from the kiosk → banner clears on the agent tab promptly.
  - [ ] Answer on one agent tab → the banner clears on a second agent tab covering the same property.
  - [ ] End the call → banner stays clear.
  - [ ] Kill the agent tab's network (DevTools offline), start a call, restore network → the banner catches up (no missed ring) within the resubscribe/poll window.
  - [ ] Confirm in Supabase Realtime inspector (or logs) that the subscribe is on `operator:<id>:calls` as a **private** channel and is authorized (not rejected).

---

## Self-review notes (already reconciled)

- **Spec coverage:** §4.1 publishers → Task 5 (all 4 routes). §4.2 subscriber → Task 6. §4.3 catch-up/reconnect/60s poll → Task 6 + Task 4. §5 channel auth → Task 8. §6 new/changed pieces → Tasks 1–3, 6, 7. §8 testing → tests in Tasks 1–6 + Task 9 smoke.
- **Type consistency:** `operatorCallsChannelTopic` / `CALLS_CHANGED_EVENT` / `broadcastCallsChanged` / `createBrowserSupabaseClient` / `INCOMING_VIDEO_FALLBACK_POLL_MS` names are used identically across tasks. `operatorId` prop is camelCase in all components; `operator_id` is the DB/row field (kiosk routes) and `actor.operatorId` is the actor field (AGENT/ADMIN routes) — matched to each route's available source.
- **No new env vars.** Reuses `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **supabase-js version:** private channels + `realtime.setAuth()` are used. If the installed `@supabase/supabase-js` (`^2.45.0`) lacks the `{ config: { private: true } }` typing or `setAuth()` at runtime, bump it (Realtime Authorization is well-supported in current 2.x); verify during Task 6 / Task 9 build.
