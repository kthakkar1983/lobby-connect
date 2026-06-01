# Plan 6a — Kiosk + Live Video Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inbound *video* calls answerable end-to-end — a lobby kiosk starts an Agora video call that the agent/admin pool answers on a 40/60 split-screen.

**Architecture:** The kiosk (`apps/kiosk`, Vite SPA, no Supabase creds) talks only to portal API routes, identified by a per-property signed config token. Portal routes (service-role) own the `calls` row and mint Agora RTC tokens. Agents poll a portal route for `RINGING` video calls and accept via a first-wins race, then join the same Agora channel. Playbook panel is an empty-state placeholder (Plan 6b); Emergency is a stub (Plan 6c).

**Tech Stack:** Next.js App Router (portal), Vite + React 19 (kiosk), Supabase (Postgres + service-role routes), Agora (`agora-token` server-side minting, `agora-rtc-sdk-ng` browser client), Vitest, Tailwind v4.

**Spec:** `docs/specs/2026-06-01-06a-kiosk-video-design.md`
**Builds on:** tag `plan-05b-agent-softphone-complete`

---

## Conventions (read once before starting)

- **Commands run from the repo root** unless stated. Test a single file: `pnpm --filter @lc/portal exec vitest run tests/path/x.test.ts` (portal) or `pnpm --filter @lc/kiosk exec vitest run tests/path/x.test.ts` (kiosk).
- **Route tests** mock `@/lib/supabase/server` + `@/lib/supabase/admin` with chainable stubs, exactly like `apps/portal/tests/app/twilio/answered.test.ts`. Copy that file's structure.
- **Env getters read `process.env` at call-time** (not via `lib/env.ts`), so `vi.stubEnv` works — same reason as `lib/twilio/config.ts`.
- **Migrations are applied manually** by the user (`supabase db reset` locally) — the Supabase MCP has no perms. The plan author commits the SQL; a step reminds the user to apply it.
- **No hardcoded hex in components** — use Tailwind token classes / CSS vars.
- **Agora browser SDK must be dynamically imported inside an effect/handler**, never at module top (SSR/test crash) — same rule as the Twilio SDK in 5b.
- After each task: `git add` the listed files and commit with the given message.

### File map (what gets created)

```
apps/kiosk/
  .env.example                                  ← VITE_PORTAL_API_URL
  src/
    types.ts                                    ← KioskConfig, CallStartResult
    lib/config.ts                               ← read config token (URL→localStorage) + API base
    lib/portal-api.ts                           ← typed fetch wrappers
    lib/agora.ts                                ← Agora client (dynamic import)
    state/call-machine.ts                       ← pure screen-state reducer (TESTED)
    screens/{Home,RecordingNotice,Ringing,Connected,Apology}.tsx
    App.tsx                                      ← wire reducer + Agora + screens (rewrite)
    index.css                                    ← + kiosk theme tokens
  tests/state/call-machine.test.ts

apps/portal/
  .env.example                                  ← + AGORA_*, KIOSK_CONFIG_SECRET
  lib/
    kiosk/config-token.ts                       ← sign/verify HMAC + secret getter (TESTED)
    agora/config.ts                             ← getAgoraCredentials() (TESTED)
    agora/token.ts                              ← buildRtcPublisherToken() (TESTED)
  app/api/
    kiosk/config/route.ts                       ← GET property kiosk info (TESTED)
    kiosk/call-started/route.ts                 ← POST insert VIDEO/RINGING (TESTED)
    kiosk/call-ended/route.ts                   ← POST finalize (TESTED)
    kiosk/heartbeat/route.ts                    ← POST 204 (TESTED)
    agora/token/route.ts                        ← GET mint RTC token (TESTED)
    calls/incoming-video/route.ts               ← GET RINGING video calls (TESTED)
    calls/[id]/answer-video/route.ts            ← POST RINGING→IN_PROGRESS (TESTED)
  components/video-call/
    incoming-video-banner.tsx                   ← polls + Accept
    video-call.tsx                              ← 40/60 overlay + Agora join + controls
    video-call-host.tsx                         ← "use client" wrapper mounted in layouts
  app/(agent)/layout.tsx                        ← mount <VideoCallHost/>
  app/(admin)/layout.tsx                        ← mount <VideoCallHost/>

packages/shared/src/supabase-types.ts           ← + 6 properties columns
supabase/migrations/0007_kiosk_info_fields.sql  ← + 6 columns
docs/setup/2026-06-01-agora-video-setup.md       ← Agora + kiosk setup guide
```

---

## Task 1: Dependencies + env scaffolding

**Files:**
- Modify: `apps/portal/package.json` (add `agora-token`)
- Modify: `apps/kiosk/package.json` (add `agora-rtc-sdk-ng`)
- Modify: `apps/portal/.env.example`, `.env.example` (root)
- Create: `apps/kiosk/.env.example`

- [ ] **Step 1: Add the Agora packages**

Run:
```bash
pnpm --filter @lc/portal add agora-token
pnpm --filter @lc/kiosk add agora-rtc-sdk-ng
```

- [ ] **Step 2: Add portal env vars** — append to `apps/portal/.env.example`:

```dotenv

# Agora video (Plan 6a). See docs/setup/2026-06-01-agora-video-setup.md
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

# Kiosk config-token signing secret (Plan 6a). Any long random string.
KIOSK_CONFIG_SECRET=
```

- [ ] **Step 3: Mirror into root `.env.example`** — under the existing `# Agora` block add:

```dotenv
KIOSK_CONFIG_SECRET=
```

- [ ] **Step 4: Create `apps/kiosk/.env.example`:**

```dotenv
# Base URL of the portal that owns all kiosk API routes.
# Local dev: http://localhost:3000 ; prod: https://lobby-connect-portal.vercel.app
VITE_PORTAL_API_URL=http://localhost:3000
```

- [ ] **Step 5: Verify install + build still green**

Run: `pnpm install && pnpm --filter @lc/portal typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/package.json apps/kiosk/package.json pnpm-lock.yaml apps/portal/.env.example apps/kiosk/.env.example .env.example
git commit -m "chore(6a): add agora deps + kiosk/agora env scaffolding"
```

---

## Task 2: Migration 0007 + shared types

**Files:**
- Create: `supabase/migrations/0007_kiosk_info_fields.sql`
- Modify: `packages/shared/src/supabase-types.ts` (properties Row/Insert/Update)

- [ ] **Step 1: Write the migration**

`supabase/migrations/0007_kiosk_info_fields.sql`:

```sql
-- 0007: kiosk home-screen owner info-card fields (Plan 6a).
-- All nullable, no defaults: a blank field is simply not rendered on the kiosk.
alter table properties
  add column if not exists kiosk_welcome_heading text,
  add column if not exists kiosk_checkin_time    text,
  add column if not exists kiosk_checkout_time   text,
  add column if not exists kiosk_wifi_network    text,
  add column if not exists kiosk_wifi_password   text,
  add column if not exists kiosk_breakfast_hours text;
```

- [ ] **Step 2: Add the fields to the shared types** — in `packages/shared/src/supabase-types.ts`, inside `properties`, add these six lines to **each** of `Row`, `Insert`, and `Update` (Row uses `: string | null;`, Insert/Update use `?: string | null;`). Place them right after the existing `kiosk_apology_message` line in each block:

Row block:
```ts
          kiosk_welcome_heading: string | null;
          kiosk_checkin_time: string | null;
          kiosk_checkout_time: string | null;
          kiosk_wifi_network: string | null;
          kiosk_wifi_password: string | null;
          kiosk_breakfast_hours: string | null;
```

Insert + Update blocks (each):
```ts
          kiosk_welcome_heading?: string | null;
          kiosk_checkin_time?: string | null;
          kiosk_checkout_time?: string | null;
          kiosk_wifi_network?: string | null;
          kiosk_wifi_password?: string | null;
          kiosk_breakfast_hours?: string | null;
```

- [ ] **Step 3: Apply the migration (user action)**

Tell the user to run, from `supabase/`:
```bash
supabase db reset
```
(Local only; consistent with 0001–0006. No backfill needed.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lc/shared build && pnpm --filter @lc/portal typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_kiosk_info_fields.sql packages/shared/src/supabase-types.ts
git commit -m "feat(6a): migration 0007 — kiosk info-card fields + shared types"
```

---

## Task 3: Kiosk config-token sign/verify (pure, TDD)

**Files:**
- Create: `apps/portal/lib/kiosk/config-token.ts`
- Test: `apps/portal/tests/lib/kiosk/config-token.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/lib/kiosk/config-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signKioskToken, verifyKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "test-secret-please-rotate";

describe("kiosk config token", () => {
  it("round-trips a property id", () => {
    const token = signKioskToken("prop-1", SECRET);
    expect(verifyKioskToken(token, SECRET)).toEqual({ propertyId: "prop-1" });
  });

  it("rejects a tampered payload", () => {
    const token = signKioskToken("prop-1", SECRET);
    const [, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ p: "prop-2", t: 1 })).toString("base64url")}.${sig}`;
    expect(verifyKioskToken(forged, SECRET)).toBeNull();
  });

  it("rejects a wrong secret", () => {
    const token = signKioskToken("prop-1", SECRET);
    expect(verifyKioskToken(token, "other-secret")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyKioskToken("garbage", SECRET)).toBeNull();
    expect(verifyKioskToken("", SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/lib/kiosk/config-token.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps/portal/lib/kiosk/config-token.ts`:

```ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

interface Payload {
  p: string; // property_id
  t: number; // issued-at (epoch seconds)
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Mint a signed kiosk config token: base64url(payload).hmac. No expiry (long-lived device token). */
export function signKioskToken(propertyId: string, secret: string): string {
  const payload: Payload = { p: propertyId, t: Math.floor(Date.now() / 1000) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Verify + decode. Returns { propertyId } or null if signature/format is invalid. */
export function verifyKioskToken(
  token: string,
  secret: string,
): { propertyId: string } | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (!payload.p || typeof payload.p !== "string") return null;
    return { propertyId: payload.p };
  } catch {
    return null;
  }
}

/** Reads KIOSK_CONFIG_SECRET at call-time (so vi.stubEnv works in tests). */
export function getKioskConfigSecret(): string {
  const s = process.env.KIOSK_CONFIG_SECRET;
  if (!s) {
    throw new Error(
      "Missing KIOSK_CONFIG_SECRET env var. Set it in apps/portal/.env.local (see .env.example).",
    );
  }
  return s;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/lib/kiosk/config-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/kiosk/config-token.ts apps/portal/tests/lib/kiosk/config-token.test.ts
git commit -m "feat(6a): kiosk config-token sign/verify (HMAC, pure)"
```

---

## Task 4: Agora token helper + creds getter (TDD)

**Files:**
- Create: `apps/portal/lib/agora/config.ts`
- Create: `apps/portal/lib/agora/token.ts`
- Test: `apps/portal/tests/lib/agora/token.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/lib/agora/token.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { buildRtcPublisherToken } from "@/lib/agora/token";
import { getAgoraCredentials } from "@/lib/agora/config";

// A valid-length 32-hex App Certificate (fake, for shape only).
const APP_ID = "a".repeat(32);
const CERT = "b".repeat(32);

describe("buildRtcPublisherToken", () => {
  it("returns a non-empty Agora token string (version-prefixed)", () => {
    const token = buildRtcPublisherToken({
      appId: APP_ID,
      appCertificate: CERT,
      channelName: "call_123",
      uid: 4242,
      expireSeconds: 3600,
    });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
    expect(token.startsWith("007")).toBe(true); // Agora AccessToken2 version prefix
  });
});

describe("getAgoraCredentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws when env is missing", () => {
    vi.stubEnv("AGORA_APP_ID", "");
    vi.stubEnv("AGORA_APP_CERTIFICATE", "");
    expect(() => getAgoraCredentials()).toThrow(/AGORA_APP_ID/);
  });

  it("returns both when set", () => {
    vi.stubEnv("AGORA_APP_ID", APP_ID);
    vi.stubEnv("AGORA_APP_CERTIFICATE", CERT);
    expect(getAgoraCredentials()).toEqual({ appId: APP_ID, appCertificate: CERT });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/lib/agora/token.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the creds getter**

`apps/portal/lib/agora/config.ts`:

```ts
import "server-only";

export interface AgoraCredentials {
  appId: string;
  appCertificate: string;
}

/** Reads AGORA_* at call-time (so vi.stubEnv works in tests). */
export function getAgoraCredentials(): AgoraCredentials {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId) throw new Error("Missing AGORA_APP_ID env var (see .env.example).");
  if (!appCertificate)
    throw new Error("Missing AGORA_APP_CERTIFICATE env var (see .env.example).");
  return { appId, appCertificate };
}
```

- [ ] **Step 4: Implement the token builder**

`apps/portal/lib/agora/token.ts`:

```ts
import "server-only";
import { RtcTokenBuilder, RtcRole } from "agora-token";

export interface RtcTokenArgs {
  appId: string;
  appCertificate: string;
  channelName: string;
  uid: number;
  expireSeconds: number;
}

/** Mint a PUBLISHER RTC token for a channel + uid (two-way A/V). */
export function buildRtcPublisherToken(args: RtcTokenArgs): string {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + args.expireSeconds;
  return RtcTokenBuilder.buildTokenWithUid(
    args.appId,
    args.appCertificate,
    args.channelName,
    args.uid,
    RtcRole.PUBLISHER,
    expire,
    expire,
  );
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/lib/agora/token.test.ts`
Expected: PASS (3 tests). If the `agora-token` API differs (older `agora-access-token`), adapt the import; the test asserts only the `007` prefix + string shape.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/lib/agora/config.ts apps/portal/lib/agora/token.ts apps/portal/tests/lib/agora/token.test.ts
git commit -m "feat(6a): agora RTC token builder + creds getter"
```

---

## Task 5: `GET /api/kiosk/config` — property kiosk info (TDD)

**Files:**
- Create: `apps/portal/app/api/kiosk/config/route.ts`
- Test: `apps/portal/tests/app/kiosk/config.test.ts`

This route authenticates via the kiosk config token (header `x-kiosk-token`) and returns the property's display fields so the kiosk can render K-01.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/kiosk/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let propertyRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/kiosk/config/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/config", {
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  propertyRow = {
    id: "prop-1",
    name: "The Sample Hotel",
    active: true,
    logo_url: null,
    kiosk_welcome_heading: null,
    kiosk_welcome_message: "How can we help?",
    kiosk_checkin_time: "3:00 PM",
    kiosk_checkout_time: null,
    kiosk_wifi_network: null,
    kiosk_wifi_password: null,
    kiosk_breakfast_hours: null,
    kiosk_apology_message: "Sorry, nobody is available.",
    property_phone_number: "+14055551234",
  };
});

describe("GET /api/kiosk/config", () => {
  it("401 without a token", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("401 with a bad token", async () => {
    expect((await GET(req("garbage"))).status).toBe(401);
  });

  it("returns display fields, defaulting the heading to the property name", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await GET(req(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.welcomeHeading).toBe("Welcome to The Sample Hotel");
    expect(body.checkinTime).toBe("3:00 PM");
    expect(body.checkoutTime).toBeNull();
  });

  it("404 when the property is inactive/missing", async () => {
    propertyRow = null;
    const token = signKioskToken("prop-1", SECRET);
    expect((await GET(req(token))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/config.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement**

`apps/portal/app/api/kiosk/config/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: p } = await admin
    .from("properties")
    .select(
      "id, name, active, logo_url, kiosk_welcome_heading, kiosk_welcome_message, kiosk_checkin_time, kiosk_checkout_time, kiosk_wifi_network, kiosk_wifi_password, kiosk_breakfast_hours, kiosk_apology_message, property_phone_number",
    )
    .eq("id", verified.propertyId)
    .maybeSingle();

  if (!p || !p.active) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  return NextResponse.json({
    propertyId: p.id,
    logoUrl: p.logo_url,
    welcomeHeading: p.kiosk_welcome_heading ?? `Welcome to ${p.name}`,
    welcomeMessage: p.kiosk_welcome_message,
    checkinTime: p.kiosk_checkin_time,
    checkoutTime: p.kiosk_checkout_time,
    wifiNetwork: p.kiosk_wifi_network,
    wifiPassword: p.kiosk_wifi_password,
    breakfastHours: p.kiosk_breakfast_hours,
    apologyMessage: p.kiosk_apology_message,
    phoneNumber: p.property_phone_number,
  });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/config/route.ts apps/portal/tests/app/kiosk/config.test.ts
git commit -m "feat(6a): GET /api/kiosk/config — kiosk info card data"
```

---

## Task 6: `POST /api/kiosk/call-started` (TDD)

**Files:**
- Create: `apps/portal/app/api/kiosk/call-started/route.ts`
- Test: `apps/portal/tests/app/kiosk/call-started.test.ts`

Inserts the VIDEO/RINGING `calls` row and returns `{ callId, channelName }`. The channel name is generated here so it is stored on the row and reused by the token route.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/kiosk/call-started.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let propertyRow: { id: string; operator_id: string; active: boolean } | null = null;
const insertSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "properties") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: propertyRow }) }),
          }),
        };
      }
      // calls
      return {
        insert: (v: Record<string, unknown>) => {
          insertSpy(v);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "call-1" } }),
            }),
          };
        },
      };
    },
  }),
}));

import { POST } from "@/app/api/kiosk/call-started/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/call-started", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

beforeEach(() => {
  insertSpy.mockClear();
  propertyRow = { id: "prop-1", operator_id: "op-1", active: true };
});

describe("POST /api/kiosk/call-started", () => {
  it("401 without a token", async () => {
    expect((await req()) && (await POST(req())).status).toBe(401);
  });

  it("inserts a VIDEO/RINGING call and returns callId + channelName", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req(token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.callId).toBe("call-1");
    expect(typeof body.channelName).toBe("string");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: "op-1",
        property_id: "prop-1",
        channel: "VIDEO",
        state: "RINGING",
      }),
    );
    expect(insertSpy.mock.calls[0]?.[0]).toHaveProperty("agora_channel_name", body.channelName);
  });

  it("404 when the property is inactive", async () => {
    propertyRow = { id: "prop-1", operator_id: "op-1", active: false };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req(token))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/call-started.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/kiosk/call-started/route.ts`:

```ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, active")
    .eq("id", verified.propertyId)
    .maybeSingle();

  if (!property || !property.active) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const channelName = `call_${randomUUID().replace(/-/g, "")}`;

  const { data: inserted } = await admin
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

  if (!inserted) {
    return NextResponse.json({ error: "Could not start call" }, { status: 500 });
  }

  return NextResponse.json({ callId: inserted.id, channelName });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/call-started.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/call-started/route.ts apps/portal/tests/app/kiosk/call-started.test.ts
git commit -m "feat(6a): POST /api/kiosk/call-started — insert VIDEO/RINGING call"
```

---

## Task 7: `POST /api/kiosk/call-ended` (TDD)

**Files:**
- Create: `apps/portal/app/api/kiosk/call-ended/route.ts`
- Test: `apps/portal/tests/app/kiosk/call-ended.test.ts`

Finalizes the call. `reason: "completed" | "no-answer" | "cancelled"` → terminal state. Computes `duration_seconds` from `answered_at`. Scoped to the kiosk's property.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/kiosk/call-ended.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

let callRow: Record<string, unknown> | null = null;
const updateSpy = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
      update: (v: Record<string, unknown>) => {
        updateSpy(v);
        return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      },
    }),
  }),
}));

import { POST } from "@/app/api/kiosk/call-ended/route";

function req(body: unknown, token?: string) {
  return new Request("http://localhost:3000/api/kiosk/call-ended", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-kiosk-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  callRow = { id: "call-1", property_id: "prop-1", state: "IN_PROGRESS", answered_at: "2026-06-01T00:00:00.000Z" };
});

describe("POST /api/kiosk/call-ended", () => {
  it("401 without a token", async () => {
    expect((await POST(req({ callId: "call-1", reason: "completed" }))).status).toBe(401);
  });

  it("marks COMPLETED + ended_at + duration from answered_at", async () => {
    const token = signKioskToken("prop-1", SECRET);
    const res = await POST(req({ callId: "call-1", reason: "completed" }, token));
    expect(res.status).toBe(204);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED" }),
    );
    expect(updateSpy.mock.calls[0]?.[0]).toHaveProperty("ended_at");
    expect(updateSpy.mock.calls[0]?.[0]).toHaveProperty("duration_seconds");
  });

  it("maps no-answer → NO_ANSWER", async () => {
    callRow = { id: "call-1", property_id: "prop-1", state: "RINGING", answered_at: null };
    const token = signKioskToken("prop-1", SECRET);
    await POST(req({ callId: "call-1", reason: "no-answer" }, token));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "NO_ANSWER" }));
  });

  it("404 when the call belongs to another property", async () => {
    callRow = { id: "call-1", property_id: "OTHER", state: "RINGING", answered_at: null };
    const token = signKioskToken("prop-1", SECRET);
    expect((await POST(req({ callId: "call-1", reason: "no-answer" }, token))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/call-ended.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/kiosk/call-ended/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

const STATE_BY_REASON: Record<string, "COMPLETED" | "NO_ANSWER" | "FAILED"> = {
  completed: "COMPLETED",
  "no-answer": "NO_ANSWER",
  cancelled: "NO_ANSWER",
  failed: "FAILED",
};

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  const verified = verifyKioskToken(token, getKioskConfigSecret());
  if (!verified) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    callId?: string;
    reason?: string;
  };
  if (!body.callId) {
    return NextResponse.json({ error: "Missing callId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, state, answered_at")
    .eq("id", body.callId)
    .maybeSingle();

  if (!call || call.property_id !== verified.propertyId) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const endedAt = new Date();
  const nextState = STATE_BY_REASON[body.reason ?? "completed"] ?? "COMPLETED";
  const durationSeconds = call.answered_at
    ? Math.max(0, Math.round((endedAt.getTime() - new Date(call.answered_at).getTime()) / 1000))
    : null;

  await admin
    .from("calls")
    .update({
      state: nextState,
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq("id", body.callId)
    .eq("property_id", verified.propertyId);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/call-ended.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/call-ended/route.ts apps/portal/tests/app/kiosk/call-ended.test.ts
git commit -m "feat(6a): POST /api/kiosk/call-ended — finalize video call"
```

---

## Task 8: `POST /api/kiosk/heartbeat` (TDD, minimal)

**Files:**
- Create: `apps/portal/app/api/kiosk/heartbeat/route.ts`
- Test: `apps/portal/tests/app/kiosk/heartbeat.test.ts`

v1 is intentionally minimal: verify the config token, return 204. No DB write (the `kiosks` liveness table is deferred — see spec §6).

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/kiosk/heartbeat.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);

import { POST } from "@/app/api/kiosk/heartbeat/route";

function req(token?: string) {
  return new Request("http://localhost:3000/api/kiosk/heartbeat", {
    method: "POST",
    headers: token ? { "x-kiosk-token": token } : {},
  });
}

describe("POST /api/kiosk/heartbeat", () => {
  it("401 without a valid token", async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("garbage"))).status).toBe(401);
  });

  it("204 with a valid token", async () => {
    expect((await POST(req(signKioskToken("prop-1", SECRET)))).status).toBe(204);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/heartbeat.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/kiosk/heartbeat/route.ts`:

```ts
import { NextResponse } from "next/server";

import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const token = request.headers.get("x-kiosk-token") ?? "";
  if (!verifyKioskToken(token, getKioskConfigSecret())) {
    return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
  }
  // v1: liveness is a no-op beyond auth. A kiosks.last_seen_at write slots in here later.
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/kiosk/heartbeat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/kiosk/heartbeat/route.ts apps/portal/tests/app/kiosk/heartbeat.test.ts
git commit -m "feat(6a): POST /api/kiosk/heartbeat — minimal liveness"
```

---

## Task 9: `GET /api/agora/token` — mint RTC token (TDD)

**Files:**
- Create: `apps/portal/app/api/agora/token/route.ts`
- Test: `apps/portal/tests/app/agora/token.test.ts`

Dual auth: **kiosk** (`x-kiosk-token`) or **agent/admin session**. Validates the requested `channel` belongs to a live call in the caller's property (kiosk) / operator (agent), then mints a publisher token for the requested `uid`.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/agora/token.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signKioskToken } from "@/lib/kiosk/config-token";

const SECRET = "unit-secret";
vi.stubEnv("KIOSK_CONFIG_SECRET", SECRET);
vi.stubEnv("AGORA_APP_ID", "a".repeat(32));
vi.stubEnv("AGORA_APP_CERTIFICATE", "b".repeat(32));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
let profileRow: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === "calls" ? callRow : profileRow }) }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/agora/token/route";

function url(params: Record<string, string>) {
  const u = new URL("http://localhost:3000/api/agora/token");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
function req(params: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(url(params), { headers });
}

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: null } });
  callRow = { id: "call-1", property_id: "prop-1", operator_id: "op-1", state: "RINGING", agora_channel_name: "call_abc" };
  profileRow = { id: "u1", operator_id: "op-1" };
});

describe("GET /api/agora/token", () => {
  it("kiosk token path: returns a token for a channel in its property", async () => {
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token.startsWith("007")).toBe(true);
    expect(body.channelName).toBe("call_abc");
    expect(body.appId).toBe("a".repeat(32));
  });

  it("kiosk token path: 403 when the channel is not in its property", async () => {
    callRow = { ...callRow!, property_id: "OTHER" };
    const res = await GET(req({ channel: "call_abc", uid: "111" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }));
    expect(res.status).toBe(403);
  });

  it("agent path: returns a token for a channel in its operator", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req({ channel: "call_abc", uid: "222" }));
    expect(res.status).toBe(200);
    expect((await res.json()).token.startsWith("007")).toBe(true);
  });

  it("401 with neither kiosk token nor session", async () => {
    expect((await GET(req({ channel: "call_abc", uid: "1" }))).status).toBe(401);
  });

  it("400 when channel or uid is missing", async () => {
    expect((await GET(req({ uid: "1" }, { "x-kiosk-token": signKioskToken("prop-1", SECRET) }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/agora/token.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/agora/token/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyKioskToken, getKioskConfigSecret } from "@/lib/kiosk/config-token";
import { getAgoraCredentials } from "@/lib/agora/config";
import { buildRtcPublisherToken } from "@/lib/agora/token";

export const runtime = "nodejs";

const TOKEN_TTL_SECONDS = 3600;
const LIVE_STATES = new Set(["RINGING", "IN_PROGRESS"]);

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get("channel") ?? "";
  const uidStr = searchParams.get("uid") ?? "";
  const uid = Number(uidStr);
  if (!channel || !uidStr || Number.isNaN(uid)) {
    return NextResponse.json({ error: "Missing channel or uid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, property_id, operator_id, state, agora_channel_name")
    .eq("agora_channel_name", channel)
    .maybeSingle();

  if (!call || !LIVE_STATES.has(call.state)) {
    return NextResponse.json({ error: "No live call for channel" }, { status: 404 });
  }

  // Auth branch 1: kiosk config token.
  const kioskToken = request.headers.get("x-kiosk-token");
  if (kioskToken) {
    const verified = verifyKioskToken(kioskToken, getKioskConfigSecret());
    if (!verified) {
      return NextResponse.json({ error: "Invalid kiosk token" }, { status: 401 });
    }
    if (verified.propertyId !== call.property_id) {
      return NextResponse.json({ error: "Channel not in property" }, { status: 403 });
    }
  } else {
    // Auth branch 2: agent/admin session in the same operator.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: me } = await admin
      .from("profiles")
      .select("id, operator_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!me || me.operator_id !== call.operator_id) {
      return NextResponse.json({ error: "Channel not in operator" }, { status: 403 });
    }
  }

  const { appId, appCertificate } = getAgoraCredentials();
  const token = buildRtcPublisherToken({
    appId,
    appCertificate,
    channelName: channel,
    uid,
    expireSeconds: TOKEN_TTL_SECONDS,
  });

  return NextResponse.json({ appId, channelName: channel, uid, token });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/agora/token.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/agora/token/route.ts apps/portal/tests/app/agora/token.test.ts
git commit -m "feat(6a): GET /api/agora/token — dual-auth RTC token minting"
```

---

## Task 10: `GET /api/calls/incoming-video` (TDD)

**Files:**
- Create: `apps/portal/app/api/calls/incoming-video/route.ts`
- Test: `apps/portal/tests/app/calls/incoming-video.test.ts`

Session-auth read the agent dashboard polls every 20s. Returns `RINGING` VIDEO calls in the caller's operator, with property names merged (2-query approach per CLAUDE.md).

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/calls/incoming-video.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let profileRow: { id: string; operator_id: string } | null = null;
let callRows: Array<Record<string, unknown>> = [];
let propertyRows: Array<{ id: string; name: string }> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: profileRow }) }) }) };
      }
      if (table === "properties") {
        return { select: () => ({ in: () => Promise.resolve({ data: propertyRows }) }) };
      }
      // calls: select().eq().eq().eq().order()
      const chain = {
        eq: () => chain,
        order: () => Promise.resolve({ data: callRows }),
      };
      return { select: () => chain };
    },
  }),
}));

import { GET } from "@/app/api/calls/incoming-video/route";

const request = new Request("http://localhost:3000/api/calls/incoming-video");

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  profileRow = { id: "u1", operator_id: "op-1" };
  callRows = [
    { id: "call-1", property_id: "prop-1", agora_channel_name: "call_abc", ring_started_at: "2026-06-01T00:00:00Z" },
  ];
  propertyRows = [{ id: "prop-1", name: "The Sample Hotel" }];
});

describe("GET /api/calls/incoming-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(request)).status).toBe(401);
  });

  it("returns ringing video calls with property names merged", async () => {
    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calls).toHaveLength(1);
    expect(body.calls[0]).toMatchObject({
      id: "call-1",
      channelName: "call_abc",
      propertyName: "The Sample Hotel",
    });
  });

  it("returns an empty list when none ringing", async () => {
    callRows = [];
    const body = await (await GET(request)).json();
    expect(body.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/calls/incoming-video.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/calls/incoming-video/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
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

  const { data: rows } = await admin
    .from("calls")
    .select("id, property_id, agora_channel_name, ring_started_at")
    .eq("operator_id", me.operator_id)
    .eq("channel", "VIDEO")
    .eq("state", "RINGING")
    .order("ring_started_at", { ascending: true });

  const calls = rows ?? [];
  const propertyIds = [...new Set(calls.map((c) => c.property_id as string))];

  let nameById = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, name")
      .in("id", propertyIds);
    nameById = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  }

  return NextResponse.json({
    calls: calls.map((c) => ({
      id: c.id,
      channelName: c.agora_channel_name,
      propertyId: c.property_id,
      propertyName: nameById.get(c.property_id as string) ?? "Property",
      ringStartedAt: c.ring_started_at,
    })),
  });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/calls/incoming-video.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/calls/incoming-video/route.ts apps/portal/tests/app/calls/incoming-video.test.ts
git commit -m "feat(6a): GET /api/calls/incoming-video — dashboard poll source"
```

---

## Task 11: `POST /api/calls/[id]/answer-video` (TDD)

**Files:**
- Create: `apps/portal/app/api/calls/[id]/answer-video/route.ts`
- Test: `apps/portal/tests/app/calls/answer-video.test.ts`

Mirrors the audio `answered` route (operator guard + `RINGING→IN_PROGRESS` race + `ON_CALL`) but returns the `channelName` so the agent can fetch its Agora token next. Reuses `canAnswer` from `lib/voice/call-state.ts`.

- [ ] **Step 1: Write the failing test**

`apps/portal/tests/app/calls/answer-video.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => Promise.resolve({ auth: { getUser: () => getUser() } }),
}));

let callRow: Record<string, unknown> | null = null;
const callUpdateSpy = vi.fn();
const profileUpdateSpy = vi.fn();
const profileFetch = vi.fn(async () => ({ data: { id: "u1", operator_id: "op-1" } }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => profileFetch() }) }),
          update: (v: unknown) => { profileUpdateSpy(v); return { eq: () => Promise.resolve({ error: null }) }; },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: callRow }) }) }),
        update: (v: unknown) => { callUpdateSpy(v); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }; },
      };
    },
  }),
}));

import { POST } from "@/app/api/calls/[id]/answer-video/route";

function call(id: string) {
  const request = new Request(`http://localhost:3000/api/calls/${id}/answer-video`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  getUser.mockReset();
  callUpdateSpy.mockClear();
  profileUpdateSpy.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  callRow = { id: "call-1", state: "RINGING", operator_id: "op-1", agora_channel_name: "call_abc" };
});

describe("POST /api/calls/[id]/answer-video", () => {
  it("401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call("call-1")).status).toBe(401);
  });

  it("claims the call (IN_PROGRESS/handled_by) + ON_CALL, returns channelName", async () => {
    const res = await call("call-1");
    expect(res.status).toBe(200);
    expect((await res.json()).channelName).toBe("call_abc");
    expect(callUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "IN_PROGRESS", handled_by_user_id: "u1" }));
    expect(profileUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ON_CALL" }));
  });

  it("409 when already answered", async () => {
    callRow = { ...callRow!, state: "IN_PROGRESS" };
    expect((await call("call-1")).status).toBe(409);
    expect(callUpdateSpy).not.toHaveBeenCalled();
  });

  it("404 across operators", async () => {
    callRow = { ...callRow!, operator_id: "OTHER" };
    expect((await call("call-1")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/calls/answer-video.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/portal/app/api/calls/[id]/answer-video/route.ts`:

```ts
import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAnswer } from "@/lib/voice/call-state";

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

  const { data: call } = await admin
    .from("calls")
    .select("id, state, operator_id, agora_channel_name")
    .eq("id", id)
    .maybeSingle();
  if (!call || call.operator_id !== me.operator_id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }
  if (!canAnswer(call.state)) {
    return NextResponse.json({ error: "Already answered" }, { status: 409 });
  }

  // Conditional on still-RINGING to lose the answer race safely.
  await admin
    .from("calls")
    .update({
      state: "IN_PROGRESS",
      handled_by_user_id: user.id,
      answered_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("state", "RINGING");

  await admin.from("profiles").update({ status: "ON_CALL" }).eq("id", user.id);

  return NextResponse.json({ channelName: call.agora_channel_name });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/portal exec vitest run tests/app/calls/answer-video.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/app/api/calls/[id]/answer-video/route.ts apps/portal/tests/app/calls/answer-video.test.ts
git commit -m "feat(6a): POST /api/calls/[id]/answer-video — first-wins claim"
```

---

## Task 12: Kiosk call-state reducer (pure, TDD)

**Files:**
- Create: `apps/kiosk/src/state/call-machine.ts`
- Test: `apps/kiosk/tests/state/call-machine.test.ts`

The kiosk screen is a pure reducer over `KioskScreen`. Side effects (Agora join, fetch) live in `App.tsx`; the reducer only models transitions, including the internal 120s timeout.

- [ ] **Step 1: Write the failing test**

`apps/kiosk/tests/state/call-machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialState, reduce, type KioskState } from "@/state/call-machine";

describe("kiosk call machine", () => {
  it("starts at home", () => {
    expect(initialState().screen).toBe("home");
  });

  it("home → disclosure on tap", () => {
    const s = reduce(initialState(), { type: "TAP_CALL" });
    expect(s.screen).toBe("disclosure");
  });

  it("disclosure → ringing on accept (records callId + channel)", () => {
    let s = reduce(initialState(), { type: "TAP_CALL" });
    s = reduce(s, { type: "ACCEPT_DISCLOSURE", callId: "c1", channelName: "call_abc" });
    expect(s.screen).toBe("ringing");
    expect(s.callId).toBe("c1");
    expect(s.channelName).toBe("call_abc");
  });

  it("ringing → connected when the agent joins", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "AGENT_JOINED" });
    expect(s.screen).toBe("connected");
  });

  it("ringing → apology on 120s timeout", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "RING_TIMEOUT" });
    expect(s.screen).toBe("apology");
  });

  it("connected → home on end", () => {
    let s: KioskState = { screen: "connected", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "END_CALL" });
    expect(s.screen).toBe("home");
  });

  it("ringing → home on cancel", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "CANCEL" });
    expect(s.screen).toBe("home");
  });

  it("apology → home on dismiss", () => {
    let s: KioskState = { screen: "apology", callId: null, channelName: null };
    s = reduce(s, { type: "DISMISS_APOLOGY" });
    expect(s.screen).toBe("home");
  });

  it("any → apology on error", () => {
    let s: KioskState = { screen: "ringing", callId: "c1", channelName: "call_abc" };
    s = reduce(s, { type: "ERROR" });
    expect(s.screen).toBe("apology");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @lc/kiosk exec vitest run tests/state/call-machine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/kiosk/src/state/call-machine.ts`:

```ts
export type KioskScreen =
  | "home"
  | "disclosure"
  | "ringing"
  | "connected"
  | "apology";

export interface KioskState {
  screen: KioskScreen;
  callId: string | null;
  channelName: string | null;
}

export type KioskAction =
  | { type: "TAP_CALL" }
  | { type: "ACCEPT_DISCLOSURE"; callId: string; channelName: string }
  | { type: "AGENT_JOINED" }
  | { type: "RING_TIMEOUT" }
  | { type: "CANCEL" }
  | { type: "END_CALL" }
  | { type: "DISMISS_APOLOGY" }
  | { type: "ERROR" };

export function initialState(): KioskState {
  return { screen: "home", callId: null, channelName: null };
}

function home(): KioskState {
  return initialState();
}

export function reduce(state: KioskState, action: KioskAction): KioskState {
  switch (action.type) {
    case "TAP_CALL":
      return state.screen === "home" ? { ...state, screen: "disclosure" } : state;
    case "ACCEPT_DISCLOSURE":
      return {
        screen: "ringing",
        callId: action.callId,
        channelName: action.channelName,
      };
    case "AGENT_JOINED":
      return state.screen === "ringing" ? { ...state, screen: "connected" } : state;
    case "RING_TIMEOUT":
      return state.screen === "ringing" ? { ...state, screen: "apology" } : state;
    case "CANCEL":
      return home();
    case "END_CALL":
      return home();
    case "DISMISS_APOLOGY":
      return home();
    case "ERROR":
      return { ...state, screen: "apology" };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @lc/kiosk exec vitest run tests/state/call-machine.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kiosk/src/state/call-machine.ts apps/kiosk/tests/state/call-machine.test.ts
git commit -m "feat(6a): kiosk call-state reducer (pure)"
```

---

## Task 13: Kiosk lib — config, portal API, Agora client

**Files:**
- Create: `apps/kiosk/src/types.ts`, `apps/kiosk/src/lib/config.ts`, `apps/kiosk/src/lib/portal-api.ts`, `apps/kiosk/src/lib/agora.ts`

No unit tests (thin I/O wrappers + dynamic SDK — verified by typecheck/lint/build + the live smoke, consistent with 5b's softphone). 

- [ ] **Step 1: Types**

`apps/kiosk/src/types.ts`:

```ts
export interface KioskConfig {
  propertyId: string;
  logoUrl: string | null;
  welcomeHeading: string;
  welcomeMessage: string | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  breakfastHours: string | null;
  apologyMessage: string | null;
  phoneNumber: string | null;
}

export interface CallStartResult {
  callId: string;
  channelName: string;
}

export interface AgoraTokenResult {
  appId: string;
  channelName: string;
  uid: number;
  token: string;
}
```

- [ ] **Step 2: Config (token + API base)**

`apps/kiosk/src/lib/config.ts`:

```ts
const TOKEN_KEY = "lc_kiosk_token";

/** Read the config token from ?t=… (persisting to localStorage) or localStorage. */
export function getKioskToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("t");
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete("t");
    window.history.replaceState({}, "", url.toString());
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getPortalApiBase(): string {
  const base = import.meta.env.VITE_PORTAL_API_URL;
  if (!base) throw new Error("Missing VITE_PORTAL_API_URL (see apps/kiosk/.env.example).");
  return base.replace(/\/$/, "");
}
```

- [ ] **Step 3: Portal API wrappers**

`apps/kiosk/src/lib/portal-api.ts`:

```ts
import { getKioskToken, getPortalApiBase } from "./config";
import type { KioskConfig, CallStartResult, AgoraTokenResult } from "../types";

function headers(): HeadersInit {
  const token = getKioskToken();
  if (!token) throw new Error("Kiosk is not configured (missing config token).");
  return { "content-type": "application/json", "x-kiosk-token": token };
}

export async function fetchKioskConfig(): Promise<KioskConfig> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/config`, { headers: headers() });
  if (!res.ok) throw new Error(`config ${res.status}`);
  return (await res.json()) as KioskConfig;
}

export async function startCall(): Promise<CallStartResult> {
  const res = await fetch(`${getPortalApiBase()}/api/kiosk/call-started`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`call-started ${res.status}`);
  return (await res.json()) as CallStartResult;
}

export async function endCall(callId: string, reason: "completed" | "no-answer" | "cancelled"): Promise<void> {
  await fetch(`${getPortalApiBase()}/api/kiosk/call-ended`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ callId, reason }),
  }).catch(() => {});
}

export async function fetchAgoraToken(channel: string, uid: number): Promise<AgoraTokenResult> {
  const url = new URL(`${getPortalApiBase()}/api/agora/token`);
  url.searchParams.set("channel", channel);
  url.searchParams.set("uid", String(uid));
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`agora-token ${res.status}`);
  return (await res.json()) as AgoraTokenResult;
}

export async function sendHeartbeat(): Promise<void> {
  await fetch(`${getPortalApiBase()}/api/kiosk/heartbeat`, {
    method: "POST",
    headers: headers(),
  }).catch(() => {});
}
```

- [ ] **Step 4: Agora client wrapper**

`apps/kiosk/src/lib/agora.ts`:

```ts
import type {
  IAgoraRTCClient,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IAgoraRTCRemoteUser,
} from "agora-rtc-sdk-ng";

export interface KioskAgoraSession {
  client: IAgoraRTCClient;
  localVideo: ICameraVideoTrack;
  localAudio: IMicrophoneAudioTrack;
  leave: () => Promise<void>;
}

/** Join a channel, publish camera+mic, and wire remote-user callbacks. Dynamic import (SSR/test safe). */
export async function joinChannel(opts: {
  appId: string;
  channel: string;
  token: string;
  uid: number;
  onRemoteVideo: (track: IAgoraRTCRemoteUser["videoTrack"]) => void;
  onAgentJoined: () => void;
  onAgentLeft: () => void;
}): Promise<KioskAgoraSession> {
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

  client.on("user-published", async (user, mediaType) => {
    await client.subscribe(user, mediaType);
    if (mediaType === "video") opts.onRemoteVideo(user.videoTrack);
    if (mediaType === "audio") user.audioTrack?.play();
    opts.onAgentJoined();
  });
  client.on("user-left", () => opts.onAgentLeft());

  await client.join(opts.appId, opts.channel, opts.token, opts.uid);
  const localAudio = await AgoraRTC.createMicrophoneAudioTrack();
  const localVideo = await AgoraRTC.createCameraVideoTrack();
  await client.publish([localAudio, localVideo]);

  return {
    client,
    localVideo,
    localAudio,
    leave: async () => {
      localAudio.close();
      localVideo.close();
      await client.leave();
    },
  };
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @lc/kiosk typecheck && pnpm --filter @lc/kiosk lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kiosk/src/types.ts apps/kiosk/src/lib/config.ts apps/kiosk/src/lib/portal-api.ts apps/kiosk/src/lib/agora.ts
git commit -m "feat(6a): kiosk lib — config token, portal API, Agora client"
```

---

## Task 14: Kiosk screens + theme tokens + App wiring

**Files:**
- Modify: `apps/kiosk/src/index.css` (theme tokens)
- Create: `apps/kiosk/src/screens/{Home,RecordingNotice,Ringing,Connected,Apology}.tsx`
- Rewrite: `apps/kiosk/src/App.tsx`

Verified by typecheck/lint/build + visual check. Landscape tablet, light theme.

- [ ] **Step 1: Add theme tokens** — append to `apps/kiosk/src/index.css`:

```css
:root {
  --kiosk-navy: #0f1f3d;
  --kiosk-cream: #f4ecd8;
  --kiosk-ink: #0f1f3d;
  --kiosk-muted: #7a6e5a;
  --kiosk-surface: #ffffff;
}
html, body, #root { height: 100%; margin: 0; }
body { background: var(--kiosk-cream); color: var(--kiosk-ink); font-family: system-ui, sans-serif; }
```

- [ ] **Step 2: Home (K-01) info card + auto-sizing button**

`apps/kiosk/src/screens/Home.tsx`:

```tsx
import type { KioskConfig } from "../types";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ fontSize: 18 }}>
      <strong>{label}: </strong>
      <span>{value}</span>
    </div>
  );
}

export function Home({ config, onCall }: { config: KioskConfig; onCall: () => void }) {
  const wifi =
    config.wifiNetwork && config.wifiPassword
      ? `${config.wifiNetwork} / ${config.wifiPassword}`
      : config.wifiNetwork;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 32, gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {config.logoUrl && (
          <img src={config.logoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover" }} />
        )}
        <h1 style={{ fontSize: 34, margin: 0 }}>{config.welcomeHeading}</h1>
      </div>
      {config.welcomeMessage && <p style={{ fontSize: 20, margin: 0, color: "var(--kiosk-muted)" }}>{config.welcomeMessage}</p>}

      <div style={{ background: "var(--kiosk-surface)", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Check-in" value={config.checkinTime} />
        <Row label="Check-out" value={config.checkoutTime} />
        <Row label="WiFi" value={wifi} />
        <Row label="Breakfast" value={config.breakfastHours} />
      </div>

      <button
        type="button"
        onClick={onCall}
        style={{
          flex: 1, minHeight: 96, border: "none", borderRadius: 16,
          background: "var(--kiosk-navy)", color: "var(--kiosk-cream)",
          fontSize: 30, fontWeight: 700, cursor: "pointer",
        }}
      >
        Talk to the Front Desk
      </button>
    </div>
  );
}
```

- [ ] **Step 3: RecordingNotice (K-02)**

`apps/kiosk/src/screens/RecordingNotice.tsx`:

```tsx
export function RecordingNotice({ onOk }: { onOk: () => void }) {
  return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ background: "var(--kiosk-surface)", borderRadius: 16, padding: 40, maxWidth: 560, textAlign: "center" }}>
        <p style={{ fontSize: 24, marginTop: 0 }}>Calls may be recorded for training purposes.</p>
        <button
          type="button"
          onClick={onOk}
          style={{ marginTop: 16, padding: "16px 40px", border: "none", borderRadius: 12, background: "var(--kiosk-navy)", color: "var(--kiosk-cream)", fontSize: 22, fontWeight: 700, cursor: "pointer" }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ringing (K-03)** — self-preview + Mute/Camera/Cancel, NO timer

`apps/kiosk/src/screens/Ringing.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { ICameraVideoTrack } from "agora-rtc-sdk-ng";

export function Ringing({
  localVideo, muted, cameraOff, onMute, onCamera, onCancel,
}: {
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (localVideo && ref.current) localVideo.play(ref.current);
  }, [localVideo]);

  return (
    <div style={{ position: "relative", height: "100%", background: "#27272a" }}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 24, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 26 }}>
        Ringing the front desk…
      </div>
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        <CtrlButton label={muted ? "Unmute" : "Mute"} onClick={onMute} />
        <CtrlButton label={cameraOff ? "Camera on" : "Camera off"} onClick={onCamera} />
        <CtrlButton label="Cancel" danger onClick={onCancel} />
      </div>
    </div>
  );
}

function CtrlButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      style={{ padding: "14px 26px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 18, fontWeight: 600, background: danger ? "#b91c1c" : "rgba(255,255,255,0.9)", color: danger ? "#fff" : "#0f1f3d" }}>
      {label}
    </button>
  );
}
```

- [ ] **Step 5: Connected (K-04)** — agent video full-screen, self PiP, End/Mute/Camera

`apps/kiosk/src/screens/Connected.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

export function Connected({
  remoteVideo, localVideo, muted, cameraOff, onMute, onCamera, onEnd,
}: {
  remoteVideo: IRemoteVideoTrack | null;
  localVideo: ICameraVideoTrack | null;
  muted: boolean;
  cameraOff: boolean;
  onMute: () => void;
  onCamera: () => void;
  onEnd: () => void;
}) {
  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (remoteVideo && remoteRef.current) remoteVideo.play(remoteRef.current); }, [remoteVideo]);
  useEffect(() => { if (localVideo && localRef.current) localVideo.play(localRef.current); }, [localVideo]);

  return (
    <div style={{ position: "relative", height: "100%", background: "#000" }}>
      <div ref={remoteRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={localRef} style={{ position: "absolute", bottom: 100, right: 24, width: 200, height: 140, borderRadius: 12, overflow: "hidden", border: "2px solid rgba(255,255,255,0.5)" }} />
      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 16 }}>
        <button type="button" onClick={onMute} style={ctrl(false)}>{muted ? "Unmute" : "Mute"}</button>
        <button type="button" onClick={onCamera} style={ctrl(false)}>{cameraOff ? "Camera on" : "Camera off"}</button>
        <button type="button" onClick={onEnd} style={ctrl(true)}>End Call</button>
      </div>
    </div>
  );
}

function ctrl(danger: boolean): React.CSSProperties {
  return { padding: "14px 26px", borderRadius: 12, border: "none", cursor: "pointer", fontSize: 18, fontWeight: 600, background: danger ? "#b91c1c" : "rgba(255,255,255,0.9)", color: danger ? "#fff" : "#0f1f3d" };
}
```

- [ ] **Step 6: Apology (K-08)**

`apps/kiosk/src/screens/Apology.tsx`:

```tsx
import { useEffect } from "react";

export function Apology({ message, phone, onDone }: { message: string | null; phone: string | null; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 10_000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ textAlign: "center", maxWidth: 620 }}>
        <p style={{ fontSize: 26 }}>{message ?? "We're sorry, no one is available right now."}</p>
        {phone && <p style={{ fontSize: 22, color: "var(--kiosk-muted)" }}>Call us directly: {phone}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: App wiring** — `apps/kiosk/src/App.tsx` (full rewrite)

```tsx
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

import { reduce, initialState } from "./state/call-machine";
import { fetchKioskConfig, startCall, endCall, fetchAgoraToken, sendHeartbeat } from "./lib/portal-api";
import { joinChannel, type KioskAgoraSession } from "./lib/agora";
import type { KioskConfig } from "./types";
import { Home } from "./screens/Home";
import { RecordingNotice } from "./screens/RecordingNotice";
import { Ringing } from "./screens/Ringing";
import { Connected } from "./screens/Connected";
import { Apology } from "./screens/Apology";

const RING_TIMEOUT_MS = 120_000;
const HEARTBEAT_MS = 30_000;

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null);
  const [localVideo, setLocalVideo] = useState<ICameraVideoTrack | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const sessionRef = useRef<KioskAgoraSession | null>(null);
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config + heartbeat.
  useEffect(() => {
    fetchKioskConfig().then(setConfig).catch(() => {});
    const id = setInterval(() => void sendHeartbeat(), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  const teardown = useCallback(async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await sessionRef.current?.leave();
    sessionRef.current = null;
    localAudioRef.current = null;
    setRemoteVideo(null);
    setLocalVideo(null);
    setMuted(false);
    setCameraOff(false);
  }, []);

  const onAccept = useCallback(async () => {
    try {
      const { callId, channelName } = await startCall();
      callIdRef.current = callId;
      const uid = Math.floor(Math.random() * 1_000_000) + 1;
      const tok = await fetchAgoraToken(channelName, uid);
      const session = await joinChannel({
        appId: tok.appId, channel: tok.channelName, token: tok.token, uid: tok.uid,
        onRemoteVideo: (t) => setRemoteVideo(t ?? null),
        onAgentJoined: () => dispatch({ type: "AGENT_JOINED" }),
        onAgentLeft: () => { void teardown(); void endCall(callIdRef.current!, "completed"); dispatch({ type: "END_CALL" }); },
      });
      sessionRef.current = session;
      localAudioRef.current = session.localAudio;
      setLocalVideo(session.localVideo);
      dispatch({ type: "ACCEPT_DISCLOSURE", callId, channelName });
      timeoutRef.current = setTimeout(() => {
        if (callIdRef.current) void endCall(callIdRef.current, "no-answer");
        void teardown();
        dispatch({ type: "RING_TIMEOUT" });
      }, RING_TIMEOUT_MS);
    } catch {
      await teardown();
      dispatch({ type: "ERROR" });
    }
  }, [teardown]);

  const onEnd = useCallback(async () => {
    if (callIdRef.current) await endCall(callIdRef.current, "completed");
    await teardown();
    dispatch({ type: "END_CALL" });
  }, [teardown]);

  const onCancel = useCallback(async () => {
    if (callIdRef.current) await endCall(callIdRef.current, "cancelled");
    await teardown();
    dispatch({ type: "CANCEL" });
  }, [teardown]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    void localAudioRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOff;
    void localVideo?.setMuted(next);
    setCameraOff(next);
  }, [cameraOff, localVideo]);

  if (!config) {
    return <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>Loading…</div>;
  }

  switch (state.screen) {
    case "home":
      return <Home config={config} onCall={() => dispatch({ type: "TAP_CALL" })} />;
    case "disclosure":
      return <RecordingNotice onOk={onAccept} />;
    case "ringing":
      return <Ringing localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onCancel={onCancel} />;
    case "connected":
      return <Connected remoteVideo={remoteVideo} localVideo={localVideo} muted={muted} cameraOff={cameraOff} onMute={toggleMute} onCamera={toggleCamera} onEnd={onEnd} />;
    case "apology":
      return <Apology message={config.apologyMessage} phone={config.phoneNumber} onDone={() => dispatch({ type: "DISMISS_APOLOGY" })} />;
  }
}
```

- [ ] **Step 8: Typecheck + lint + build**

Run: `pnpm --filter @lc/kiosk typecheck && pnpm --filter @lc/kiosk lint && pnpm --filter @lc/kiosk build`
Expected: PASS. (If the React UMD type for `React.CSSProperties` is unresolved in `Connected.tsx`, add `import type { CSSProperties } from "react"` and use `CSSProperties`.)

- [ ] **Step 9: Commit**

```bash
git add apps/kiosk/src/index.css apps/kiosk/src/screens apps/kiosk/src/App.tsx
git commit -m "feat(6a): kiosk screens (K-01..K-08) + App state wiring"
```

---

## Task 15: Agent incoming-video banner + 40/60 video-call overlay

**Files:**
- Create: `apps/portal/components/video-call/incoming-video-banner.tsx`
- Create: `apps/portal/components/video-call/video-call.tsx`
- Create: `apps/portal/components/video-call/video-call-host.tsx`

Verified by typecheck/lint/build. Agora SDK dynamically imported.

- [ ] **Step 1: Incoming banner (polls every 20s)**

`apps/portal/components/video-call/incoming-video-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";

export interface IncomingVideoCall {
  id: string;
  channelName: string;
  propertyName: string;
}

const POLL_MS = 20_000;

export function IncomingVideoBanner({ onAccept }: { onAccept: (call: IncomingVideoCall) => void }) {
  const [calls, setCalls] = useState<IncomingVideoCall[]>([]);

  useEffect(() => {
    let active = true;
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
    void tick();
    const id = setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (calls.length === 0) return null;
  const call = calls[0];

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Video size={16} /> Incoming video call · {call.propertyName}
      </div>
      <button
        type="button"
        onClick={() => onAccept(call)}
        className="mt-3 w-full rounded-md bg-primary px-3 py-2 text-primary-foreground"
      >
        Accept video call
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 40/60 connected overlay**

`apps/portal/components/video-call/video-call.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertTriangle } from "lucide-react";
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";

export function VideoCall({ callId, onClose }: { callId: string; onClose: () => void }) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const remoteRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const audioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const videoRef = useRef<ICameraVideoTrack | null>(null);

  // Accept the call, then join Agora.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ans = await fetch(`/api/calls/${callId}/answer-video`, { method: "POST" });
        if (!ans.ok) return onClose();
        const { channelName } = (await ans.json()) as { channelName: string };

        const uid = Math.floor(Math.random() * 1_000_000) + 1_000_001;
        const tokRes = await fetch(`/api/agora/token?channel=${encodeURIComponent(channelName)}&uid=${uid}`);
        if (!tokRes.ok) return onClose();
        const tok = (await tokRes.json()) as { appId: string; token: string; channelName: string; uid: number };

        const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        clientRef.current = client;
        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "video" && remoteRef.current) (user.videoTrack as IRemoteVideoTrack)?.play(remoteRef.current);
          if (mediaType === "audio") user.audioTrack?.play();
        });
        client.on("user-left", () => void handleEnd());

        await client.join(tok.appId, tok.channelName, tok.token, tok.uid);
        const audio = await AgoraRTC.createMicrophoneAudioTrack();
        const video = await AgoraRTC.createCameraVideoTrack();
        audioRef.current = audio;
        videoRef.current = video;
        await client.publish([audio, video]);
        if (!cancelled && localRef.current) video.play(localRef.current);
      } catch {
        if (!cancelled) onClose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  async function handleEnd() {
    try {
      if (roomNumber || notes) {
        await fetch("/api/calls/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callId, roomNumber, notes }),
        }).catch(() => {});
      }
      audioRef.current?.close();
      videoRef.current?.close();
      await clientRef.current?.leave();
    } finally {
      onClose();
    }
  }

  function toggleMute() { const n = !muted; void audioRef.current?.setMuted(n); setMuted(n); }
  function toggleCamera() { const n = !cameraOff; void videoRef.current?.setMuted(n); setCameraOff(n); }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        {/* 40% guest video (left) */}
        <div className="relative basis-2/5 bg-neutral-900">
          <div ref={remoteRef} className="absolute inset-0" />
          <div ref={localRef} className="absolute bottom-4 right-4 h-28 w-40 overflow-hidden rounded-md border border-white/40" />
        </div>
        {/* 60% playbook (right) — empty-state in 6a */}
        <div className="flex basis-3/5 items-center justify-center border-l border-border bg-card text-text-muted">
          No playbook uploaded yet.
        </div>
      </div>

      {/* control bar */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="Room #"
          className="w-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        <button type="button" onClick={toggleMute} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm">
          {muted ? <MicOff size={16} /> : <Mic size={16} />}{muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={toggleCamera} className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm">
          {cameraOff ? <VideoOff size={16} /> : <Video size={16} />}{cameraOff ? "Cam on" : "Cam off"}
        </button>
        <button type="button" disabled title="Coming soon" className="rounded-md border border-border px-3 py-2 text-sm opacity-40">Hold</button>
        <button type="button" disabled title="Coming soon" className="rounded-md border border-border px-3 py-2 text-sm opacity-40">Swap</button>
        <button type="button" onClick={() => setEmergencyOpen(true)} className="flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={16} /> Emergency
        </button>
        <button type="button" onClick={() => void handleEnd()} className="flex items-center gap-1 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          <PhoneOff size={16} /> End
        </button>
      </div>

      {emergencyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="max-w-md rounded-lg bg-card p-6">
            <h2 className="text-lg font-semibold text-red-700">Emergency response</h2>
            <p className="mt-2 text-sm text-text-muted">Emergency calling arrives in Plan 6c (conference to emergency services, alert the on-call manager, log an incident).</p>
            <button type="button" onClick={() => setEmergencyOpen(false)} className="mt-4 rounded-md border border-border px-3 py-2 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Host wrapper (banner → overlay)**

`apps/portal/components/video-call/video-call-host.tsx`:

```tsx
"use client";

import { useState } from "react";
import { IncomingVideoBanner, type IncomingVideoCall } from "./incoming-video-banner";
import { VideoCall } from "./video-call";

export function VideoCallHost() {
  const [active, setActive] = useState<IncomingVideoCall | null>(null);

  return (
    <>
      {!active && <IncomingVideoBanner onAccept={setActive} />}
      {active && <VideoCall callId={active.id} onClose={() => setActive(null)} />}
    </>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint`
Expected: PASS. (If Tailwind tokens like `text-text-muted` / `bg-destructive` are not in the theme, swap for the nearest existing token used by the 5b softphone — check `components/softphone/softphone.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add apps/portal/components/video-call
git commit -m "feat(6a): agent incoming-video banner + 40/60 video-call overlay"
```

---

## Task 16: Mount the video-call host in both portals

**Files:**
- Modify: `apps/portal/app/(agent)/layout.tsx`
- Modify: `apps/portal/app/(admin)/layout.tsx`

Mount `<VideoCallHost/>` next to the existing `<Softphone/>` so video calls announce in the same chrome.

- [ ] **Step 1: Inspect where the softphone is mounted**

Run: `grep -n "Softphone" apps/portal/app/\(agent\)/layout.tsx apps/portal/app/\(admin\)/layout.tsx`
Note the import + JSX placement.

- [ ] **Step 2: Add the import + element to the agent layout** — alongside the `<Softphone .../>`:

```tsx
import { VideoCallHost } from "@/components/video-call/video-call-host";
// ...
<VideoCallHost />
```

- [ ] **Step 3: Same for the admin layout** — add the import and place `<VideoCallHost />` next to `<Softphone .../>`.

- [ ] **Step 4: Typecheck + lint + build**

Run: `pnpm --filter @lc/portal typecheck && pnpm --filter @lc/portal lint && pnpm --filter @lc/portal build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/(agent)/layout.tsx" "apps/portal/app/(admin)/layout.tsx"
git commit -m "feat(6a): mount VideoCallHost in agent + admin portals"
```

---

## Task 17: Agora + kiosk setup guide

**Files:**
- Create: `docs/setup/2026-06-01-agora-video-setup.md`

- [ ] **Step 1: Write the setup guide** with these sections (full prose, mirroring `docs/setup/2026-05-30-twilio-voice-setup.md`):

1. **Create the Agora project** — console.agora.io → Projects → *Create* → name **"Lobby Connect"** → **Secured mode (APP ID + Token)** (NOT testing mode). Copy the **App ID**.
2. **Enable the App Certificate** — project → *Config* → enable **Primary Certificate** → copy it.
3. **Env** — set in `apps/portal/.env.local`:
   ```dotenv
   AGORA_APP_ID=<app id>
   AGORA_APP_CERTIFICATE=<primary certificate>
   KIOSK_CONFIG_SECRET=<openssl rand -hex 32>
   ```
   and `apps/kiosk/.env.local`:
   ```dotenv
   VITE_PORTAL_API_URL=http://localhost:3000
   ```
   Add all four to Vercel project env (portal + kiosk) for deploy.
4. **Mint a kiosk config token** (pilot, manual) — a Node one-liner using the signer:
   ```bash
   node -e "const {signKioskToken}=require('./apps/portal/lib/kiosk/config-token.ts'); console.log(signKioskToken('<PROPERTY_UUID>', process.env.KIOSK_CONFIG_SECRET))"
   ```
   (Run via `tsx`/`ts-node`, or temporarily expose a dev-only script. The token is the `?t=` value in the kiosk URL.)
5. **Kiosk launch checklist (nightly)** — open `https://<kiosk-url>/?t=<token>` once per device → grant camera + mic when first prompted (Chrome persists per origin) → lock orientation to landscape → leave on the K-01 home screen.
6. **Free-tier note** — 10,000 video min/month covers the pilot.

- [ ] **Step 2: Commit**

```bash
git add docs/setup/2026-06-01-agora-video-setup.md
git commit -m "docs(6a): Agora + kiosk setup guide"
```

---

## Task 18: Full suite, seed, live smoke, tag, memory

**Files:**
- Modify: `MEMORY.md`, `memory/project-status.md`

- [ ] **Step 1: Full green suite**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: all PASS across portal + kiosk + shared.

- [ ] **Step 2: Seed kiosk info for the pilot property (user, SQL editor / local)**

```sql
update properties set
  kiosk_welcome_heading = 'Welcome to The Sample Hotel',
  kiosk_checkin_time   = '3:00 PM',
  kiosk_checkout_time  = '11:00 AM',
  kiosk_wifi_network   = 'SampleHotel-Guest',
  kiosk_wifi_password  = 'welcome123',
  kiosk_breakfast_hours = '7–10 AM, Lobby'
where routing_did = '+14058750410';
```

- [ ] **Step 3: Live two-surface smoke**

1. Set `AGORA_*` + `KIOSK_CONFIG_SECRET` in `apps/portal/.env.local`; mint a kiosk token for the pilot property (Task 17 step 4).
2. `pnpm dev:portal` and `pnpm dev:kiosk`. Open the kiosk at `http://localhost:5173/?t=<token>`.
3. Confirm **K-01** renders the seeded info card with an auto-sized button. Tap → **K-02** disclosure → OK.
4. In a second browser, sign in as `alex.agent@lobbyconnect.local` → the **incoming video banner** appears (≤20s) → Accept.
5. Confirm two-way video (kiosk **K-04**, agent 40/60 overlay), Mute/Cam toggles, type Room #/Notes, End → kiosk returns to **K-01**, agent overlay closes.
6. In Supabase, confirm the `calls` row went `RINGING → IN_PROGRESS → COMPLETED` with `handled_by_user_id`, `answered_at`, `duration_seconds`, and `room_number`/`notes`.
7. No-answer run: start a call, don't accept → after 120s kiosk shows **K-08** apology (10s) → home; `calls` row = `NO_ANSWER`.

- [ ] **Step 4: Update memory** — in `memory/project-status.md`, mark 6a complete (tag below) and set next = **6b** (playbook). In `MEMORY.md`, update the index line. Keep the global auto-memory pointer untouched (it defers to the repo).

- [ ] **Step 5: Tag + commit**

```bash
git add MEMORY.md memory/project-status.md
git commit -m "chore(6a): mark 6a complete; next 6b (playbook)"
git tag plan-06a-kiosk-video-complete
```

---

## Self-Review (author's check against the spec)

- **§2 scope (kiosk app, 7 routes, agent video, migration, setup):** kiosk app = T12–T14; routes = T5–T11 (config, call-started, call-ended, heartbeat, agora/token, incoming-video, answer-video); agent UI = T15–T16; migration = T2; setup guide = T17. ✓
- **§3.1 info card / auto-sizing button:** T14 Home (flex button `flex:1`, blank `Row` returns null). ✓
- **§3.3 config token (URL→localStorage, header, verify):** T3 (pure) + T13 (`config.ts`) + every kiosk route verifies. ✓
- **§3.4 flow K-01..K-08, no timer, internal 120s:** T12 reducer + T14 App (`RING_TIMEOUT_MS`, no countdown rendered). ✓
- **§3.5 incoming routing poll + first-wins 409:** T10 (poll source) + T11 (`canAnswer` + `.eq("state","RINGING")`). ✓
- **§3.6 40/60 video-left, self-PiP, controls incl. Hold/Swap disabled + Emergency stub + Room#/Notes via /api/calls/notes:** T15 `video-call.tsx`. ✓
- **§3.8 Agora tokens dual-auth:** T4 builder + T9 route (kiosk vs session branch). ✓
- **§6 heartbeat minimal, no kiosks table:** T8. ✓
- **§8 migration 0007:** T2. ✓
- **§9 playbook empty-state + Emergency "coming soon":** T15 (empty-state panel + emergency dialog). ✓
- **Placeholder scan:** no TBD/TODO; every code step has full code. ✓
- **Type consistency:** `signKioskToken`/`verifyKioskToken`, `buildRtcPublisherToken`, `KioskState`/`reduce`, `IncomingVideoCall`, `channelName` naming consistent across tasks. ✓
- **Known soft spots flagged inline:** Tailwind token names (T15 step 4) and `agora-token` API shape (T4 step 5) each carry a fallback note for the implementer.
