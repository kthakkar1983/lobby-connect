# Plan 5a — Voice Path (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inbound audio call path on the server — when a guest dials a property's number, Twilio hits our webhook, we identify who should answer (deduped), and return parallel-dial TwiML that will ring their browser softphones, recording the call's lifecycle in `calls`.

**Architecture:** Pure, unit-tested logic in `apps/portal/lib/voice/` (identity, dial planning + dedup, TwiML builders, result mapping) with thin Node-runtime webhook routes in `apps/portal/app/api/twilio/voice/` that verify the Twilio HMAC signature, load data via the service-role Supabase client, and call the pure functions. No browser, no token route (those are Plan 5b).

**Tech Stack:** Next.js 15 App Router (route handlers, `runtime = 'nodejs'`), `twilio` Node SDK (HMAC verify + TwiML — we hand-build TwiML strings, SDK used only for `validateRequest`), Supabase service-role client, Vitest.

**Spec:** `docs/specs/2026-05-30-05a-voice-backend-design.md`
**Setup guide (manual Twilio steps, done by Kumar):** `docs/setup/2026-05-30-twilio-voice-setup.md`
**Builds on:** tag `plan-04c-assignments-availability-complete`

**Conventions reused (verified in repo):**
- Path alias `@/` → `apps/portal/` (works in tests too). DB types: `@lc/shared/database.types`.
- Service-role client: `import { createAdminClient } from "@/lib/supabase/admin"`.
- Tests live in `apps/portal/tests/...`, run with `pnpm --filter @lc/portal test` (or `pnpm test` from `apps/portal`). Vitest style: `import { describe, it, expect } from "vitest"`.
- All commands below run from `apps/portal/` unless noted. Lint scope is `app components lib`.

**Confirmed schema (from `supabase/migrations/0001_init.sql`):**
- `profiles(id, operator_id, full_name, role, twilio_identity, status, last_seen_at, active, ...)`
- `properties(id, operator_id, name, routing_did, active, ...)`
- `property_assignments(id, operator_id, property_id, primary_agent_id, backup_agent_id, effective_from, effective_until, ...)`
- `admin_call_availability(operator_id, profile_id, property_id, accepting_calls, ...)` PK `(operator_id, profile_id, property_id)`
- `calls(id, operator_id, property_id, channel, state, twilio_call_sid unique, caller_number, handled_by_user_id, ring_started_at default now, answered_at, ended_at, duration_seconds, ...)`; `state in ('RINGING','IN_PROGRESS','COMPLETED','NO_ANSWER','FAILED')`; `channel in ('AUDIO','VIDEO')`.

---

## Task 1: Install Twilio SDK + env config

**Files:**
- Modify: `apps/portal/package.json` (add `twilio` dependency)
- Create: `apps/portal/lib/twilio/config.ts`
- Test: `apps/portal/tests/lib/twilio/config.test.ts`
- Modify: `apps/portal/.env.example`

- [ ] **Step 1: Install the Twilio SDK**

Run (from `apps/portal/`):
```bash
pnpm add twilio
```
Expected: `twilio` appears under `dependencies` in `apps/portal/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/portal/tests/lib/twilio/config.test.ts`:
```ts
import { describe, it, expect, afterEach, vi } from "vitest";

import { getTwilioConfig } from "@/lib/twilio/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTwilioConfig", () => {
  it("returns the three required values when all env vars are set", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok123");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");

    expect(getTwilioConfig()).toEqual({
      accountSid: "AC123",
      authToken: "tok123",
      phoneNumber: "+15555550100",
    });
  });

  it("throws when a required env var is missing", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");

    expect(() => getTwilioConfig()).toThrow(/Missing TWILIO_/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/lib/twilio/config.test.ts`
Expected: FAIL — cannot resolve `@/lib/twilio/config`.

- [ ] **Step 4: Write minimal implementation**

Create `apps/portal/lib/twilio/config.ts`:
```ts
import "server-only";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

/**
 * Reads + validates the Twilio env vars required by the 5a voice path.
 * (API key/secret are gathered now but only validated/used by 5b's token route.)
 * Reads process.env at call time so tests can stub it.
 */
export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !phoneNumber) {
    throw new Error(
      "Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER env vars",
    );
  }

  return { accountSid, authToken, phoneNumber };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/lib/twilio/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Document env vars**

Append to `apps/portal/.env.example`:
```bash
# Twilio (voice path — Plan 5a/5b). See docs/setup/2026-05-30-twilio-voice-setup.md
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_PHONE_NUMBER=
```

- [ ] **Step 7: Commit**

```bash
git add apps/portal/package.json apps/portal/pnpm-lock.yaml ../../pnpm-lock.yaml apps/portal/lib/twilio/config.ts apps/portal/tests/lib/twilio/config.test.ts apps/portal/.env.example
git commit -m "feat(voice): add twilio SDK + validated env config"
```
(If the lockfile lives at the repo root only, `git add` will skip the missing path harmlessly. Adjust to whichever lockfile changed.)

---

## Task 2: `toTwilioIdentity` — deterministic identity derivation

**Files:**
- Create: `apps/portal/lib/voice/identity.ts`
- Test: `apps/portal/tests/lib/voice/identity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import { toTwilioIdentity } from "@/lib/voice/identity";

describe("toTwilioIdentity", () => {
  it("prefixes lc_ and strips dashes from the uuid", () => {
    expect(toTwilioIdentity("00000000-0000-0000-0000-0000000000b3")).toBe(
      "lc_000000000000000000000000000000b3",
    );
  });

  it("is deterministic", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(toTwilioIdentity(id)).toBe(toTwilioIdentity(id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/identity.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/identity`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/identity.ts`:
```ts
/**
 * Deterministic Twilio Client identity for a call-taker (AGENT/ADMIN).
 * Same function is reused by Plan 5b's token route so the registered Device
 * identity matches what routing dials. OWNER profiles never get an identity.
 */
export function toTwilioIdentity(userId: string): string {
  return `lc_${userId.replace(/-/g, "")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/identity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/identity.ts apps/portal/tests/lib/voice/identity.test.ts
git commit -m "feat(voice): deterministic toTwilioIdentity"
```

---

## Task 3: `planDial` — merge primary agent + accepting admins, dedup

**Files:**
- Create: `apps/portal/lib/voice/plan-dial.ts`
- Test: `apps/portal/tests/lib/voice/plan-dial.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/plan-dial.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import { planDial } from "@/lib/voice/plan-dial";

const agent = { id: "a1", twilioIdentity: "lc_a1" };
const adminX = { id: "x1", twilioIdentity: "lc_x1" };

describe("planDial", () => {
  it("agent only", () => {
    expect(planDial({ primaryAgent: agent, availableAdmins: [] })).toEqual([
      { identity: "lc_a1" },
    ]);
  });

  it("admins only (property unassigned)", () => {
    expect(
      planDial({ primaryAgent: null, availableAdmins: [adminX] }),
    ).toEqual([{ identity: "lc_x1" }]);
  });

  it("agent + distinct admins → all, agent first", () => {
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [adminX] }),
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("dedups the admin who is also the primary agent", () => {
    const both = { id: "a1", twilioIdentity: "lc_a1" };
    expect(
      planDial({ primaryAgent: agent, availableAdmins: [both, adminX] }),
    ).toEqual([{ identity: "lc_a1" }, { identity: "lc_x1" }]);
  });

  it("returns [] when nobody is reachable", () => {
    expect(planDial({ primaryAgent: null, availableAdmins: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/plan-dial.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/plan-dial`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/plan-dial.ts`:
```ts
export interface DialCandidate {
  id: string;
  twilioIdentity: string;
}

export interface DialInput {
  primaryAgent: DialCandidate | null;
  availableAdmins: DialCandidate[];
}

export interface DialTarget {
  identity: string;
}

/**
 * Build the parallel-dial target list: the assigned primary agent (always, if
 * present) followed by accepting admins, deduplicated by twilio_identity so an
 * admin who is BOTH the primary agent and accepting-for-this-property is dialed
 * once. Empty result = nobody reachable.
 */
export function planDial(input: DialInput): DialTarget[] {
  const candidates: DialCandidate[] = [];
  if (input.primaryAgent) candidates.push(input.primaryAgent);
  candidates.push(...input.availableAdmins);

  const seen = new Set<string>();
  const targets: DialTarget[] = [];
  for (const c of candidates) {
    if (!c.twilioIdentity) continue;
    if (seen.has(c.twilioIdentity)) continue;
    seen.add(c.twilioIdentity);
    targets.push({ identity: c.twilioIdentity });
  }
  return targets;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/plan-dial.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/plan-dial.ts apps/portal/tests/lib/voice/plan-dial.test.ts
git commit -m "feat(voice): planDial with admin dedup"
```

---

## Task 4: TwiML builders

**Files:**
- Create: `apps/portal/lib/voice/twiml.ts`
- Test: `apps/portal/tests/lib/voice/twiml.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/twiml.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import {
  buildIncomingTwiml,
  buildApologyTwiml,
  buildNotInServiceTwiml,
  buildHangupTwiml,
} from "@/lib/voice/twiml";

const opts = {
  greeting: "Connecting you to the front desk, one moment.",
  timeoutSeconds: 120,
  actionUrl: "https://x.test/api/twilio/voice/dial-result",
  apologyMessage: "Sorry, no one is available.",
};

describe("twiml builders", () => {
  it("builds incoming TwiML with one Client and the dial attributes", () => {
    const xml = buildIncomingTwiml([{ identity: "lc_a1" }], opts);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        "<Response>" +
        "<Say>Connecting you to the front desk, one moment.</Say>" +
        '<Dial timeout="120" action="https://x.test/api/twilio/voice/dial-result" method="POST">' +
        "<Client>lc_a1</Client>" +
        "</Dial>" +
        "</Response>",
    );
  });

  it("includes every target as a Client", () => {
    const xml = buildIncomingTwiml(
      [{ identity: "lc_a1" }, { identity: "lc_x1" }],
      opts,
    );
    expect(xml).toContain("<Client>lc_a1</Client><Client>lc_x1</Client>");
  });

  it("falls back to apology when there are no targets", () => {
    const xml = buildIncomingTwiml([], opts);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        "<Response><Say>Sorry, no one is available.</Say><Hangup/></Response>",
    );
  });

  it("apology and not-in-service return identical text in 5a", () => {
    expect(buildNotInServiceTwiml("m")).toBe(buildApologyTwiml("m"));
  });

  it("escapes XML-special characters in spoken text", () => {
    expect(buildApologyTwiml("Tom & Jerry")).toContain("Tom &amp; Jerry");
  });

  it("builds a bare hangup", () => {
    expect(buildHangupTwiml()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/twiml.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/twiml`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/twiml.ts`:
```ts
import type { DialTarget } from "@/lib/voice/plan-dial";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface IncomingTwimlOpts {
  greeting: string;
  timeoutSeconds: number;
  actionUrl: string;
  apologyMessage: string;
}

export function buildApologyTwiml(message: string): string {
  return `${XML_DECL}<Response><Say>${escapeXml(message)}</Say><Hangup/></Response>`;
}

// 5a: a "number not in service" situation reuses the generic apology text.
// Kept as its own function so switching to a distinct message later is one line.
export function buildNotInServiceTwiml(message: string): string {
  return buildApologyTwiml(message);
}

export function buildHangupTwiml(): string {
  return `${XML_DECL}<Response><Hangup/></Response>`;
}

export function buildIncomingTwiml(
  targets: DialTarget[],
  opts: IncomingTwimlOpts,
): string {
  if (targets.length === 0) return buildApologyTwiml(opts.apologyMessage);

  const clients = targets
    .map((t) => `<Client>${escapeXml(t.identity)}</Client>`)
    .join("");

  return (
    `${XML_DECL}<Response>` +
    `<Say>${escapeXml(opts.greeting)}</Say>` +
    `<Dial timeout="${opts.timeoutSeconds}" action="${escapeXml(opts.actionUrl)}" method="POST">` +
    clients +
    `</Dial></Response>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/twiml.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/twiml.ts apps/portal/tests/lib/voice/twiml.test.ts
git commit -m "feat(voice): TwiML builders"
```

---

## Task 5: Call-result mapping helpers

**Files:**
- Create: `apps/portal/lib/voice/result.ts`
- Test: `apps/portal/tests/lib/voice/result.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/voice/result.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import {
  resolveDialResult,
  mapFinalCallState,
  isTerminalState,
  parseDurationSeconds,
} from "@/lib/voice/result";

describe("resolveDialResult", () => {
  it("completed → COMPLETED + hangup", () => {
    expect(resolveDialResult("completed")).toEqual({
      finalState: "COMPLETED",
      hangup: true,
    });
  });

  it("anything else → NO_ANSWER + apology (no hangup)", () => {
    for (const s of ["no-answer", "busy", "failed", "canceled"]) {
      expect(resolveDialResult(s)).toEqual({
        finalState: "NO_ANSWER",
        hangup: false,
      });
    }
  });
});

describe("mapFinalCallState", () => {
  it("maps terminal Twilio call statuses", () => {
    expect(mapFinalCallState("completed")).toBe("COMPLETED");
    expect(mapFinalCallState("failed")).toBe("FAILED");
    expect(mapFinalCallState("canceled")).toBe("FAILED");
    expect(mapFinalCallState("busy")).toBe("NO_ANSWER");
    expect(mapFinalCallState("no-answer")).toBe("NO_ANSWER");
  });

  it("returns null for non-terminal statuses", () => {
    expect(mapFinalCallState("ringing")).toBeNull();
    expect(mapFinalCallState("in-progress")).toBeNull();
  });
});

describe("isTerminalState", () => {
  it("recognizes terminal call states", () => {
    expect(isTerminalState("COMPLETED")).toBe(true);
    expect(isTerminalState("NO_ANSWER")).toBe(true);
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("RINGING")).toBe(false);
  });
});

describe("parseDurationSeconds", () => {
  it("parses an integer string", () => {
    expect(parseDurationSeconds("42")).toBe(42);
  });
  it("returns null for empty/invalid", () => {
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds("abc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/voice/result.test.ts`
Expected: FAIL — cannot resolve `@/lib/voice/result`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/voice/result.ts`:
```ts
export type CallState =
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "NO_ANSWER"
  | "FAILED";

const TERMINAL: ReadonlySet<CallState> = new Set([
  "COMPLETED",
  "NO_ANSWER",
  "FAILED",
]);

export function isTerminalState(state: CallState): boolean {
  return TERMINAL.has(state);
}

/**
 * Decide what /dial-result should do given Twilio's DialCallStatus.
 * `completed` means the call was answered and has now ended.
 */
export function resolveDialResult(dialCallStatus: string): {
  finalState: CallState;
  hangup: boolean;
} {
  if (dialCallStatus === "completed") {
    return { finalState: "COMPLETED", hangup: true };
  }
  return { finalState: "NO_ANSWER", hangup: false };
}

/** Map a Twilio call StatusCallback CallStatus to a terminal CallState, or null. */
export function mapFinalCallState(callStatus: string): CallState | null {
  switch (callStatus) {
    case "completed":
      return "COMPLETED";
    case "failed":
    case "canceled":
      return "FAILED";
    case "busy":
    case "no-answer":
      return "NO_ANSWER";
    default:
      return null;
  }
}

export function parseDurationSeconds(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/voice/result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/voice/result.ts apps/portal/tests/lib/voice/result.test.ts
git commit -m "feat(voice): dial-result + status mapping helpers"
```

---

## Task 6: Twilio HMAC verification + public-URL helper

**Files:**
- Create: `apps/portal/lib/twilio/client.ts`
- Test: `apps/portal/tests/lib/twilio/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/twilio/client.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const validateRequest = vi.fn();

vi.mock("twilio", () => ({
  default: { validateRequest: (...args: unknown[]) => validateRequest(...args) },
}));

import { validateTwilioSignature, publicUrlFromRequest } from "@/lib/twilio/client";

beforeEach(() => {
  validateRequest.mockReset();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok123");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateTwilioSignature", () => {
  it("returns false immediately when the signature header is missing", () => {
    expect(validateTwilioSignature(null, "https://x.test/y", {})).toBe(false);
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it("delegates to twilio.validateRequest with the auth token", () => {
    validateRequest.mockReturnValue(true);
    const ok = validateTwilioSignature("sig", "https://x.test/y", { To: "+1" });
    expect(ok).toBe(true);
    expect(validateRequest).toHaveBeenCalledWith(
      "tok123",
      "sig",
      "https://x.test/y",
      { To: "+1" },
    );
  });
});

describe("publicUrlFromRequest", () => {
  it("reconstructs the public URL from forwarded headers", () => {
    const req = new Request("http://localhost:3000/api/twilio/voice/incoming", {
      headers: {
        host: "abc.trycloudflare.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(publicUrlFromRequest(req)).toBe(
      "https://abc.trycloudflare.com/api/twilio/voice/incoming",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/twilio/client.test.ts`
Expected: FAIL — cannot resolve `@/lib/twilio/client`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/twilio/client.ts`:
```ts
import "server-only";

import twilio from "twilio";

import { getTwilioConfig } from "@/lib/twilio/config";

/**
 * Verify an inbound Twilio webhook HMAC signature.
 * `url` MUST be the exact public URL Twilio requested (incl. query string);
 * `params` are the POST form fields. Returns false on a missing signature.
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  const { authToken } = getTwilioConfig();
  return twilio.validateRequest(authToken, signature, url, params);
}

/**
 * Reconstruct the public URL Twilio used to reach us, from forwarded headers.
 * Behind a tunnel (cloudflared) the Host header is the public hostname and
 * x-forwarded-proto is https — which is what Twilio signed.
 */
export function publicUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/twilio/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/portal/lib/twilio/client.ts apps/portal/tests/lib/twilio/client.test.ts
git commit -m "feat(voice): twilio HMAC verify + public-URL helper"
```

---

## Task 7: Consolidate `twilio_identity` onto the spec format (`lc_<uuid>`)

**Context (important — this is a consolidation, not a greenfield add):** `twilio_identity` is *already* assigned today, but via a duplicated, collision-prone format `user-<first8hex>` in **two** places:
- `apps/portal/lib/users/invite.ts` — a local `twilioIdentityFor(role, userId)` (lines ~22–25), used in the profile insert (line ~71).
- `apps/portal/app/(admin)/admin/users/actions.ts` — `updateUserAction`'s role-change branch sets `updates.twilio_identity = \`user-${target.id.slice(0, 8)}\`` (line ~156).

This task replaces both with one shared helper in the spec's collision-free `lc_<uuid-without-dashes>` format and updates the existing invite test that asserts the old value.

**Files:**
- Create: `apps/portal/lib/users/twilio-identity.ts`
- Test: `apps/portal/tests/lib/users/twilio-identity.test.ts`
- Modify: `apps/portal/lib/users/invite.ts` (remove local `twilioIdentityFor`, use the shared helper)
- Modify: `apps/portal/app/(admin)/admin/users/actions.ts` (`updateUserAction` role-change branch)
- Modify: `apps/portal/tests/lib/users/invite.test.ts` (expected identity → new format)

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/lib/users/twilio-identity.test.ts`:
```ts
import { describe, it, expect } from "vitest";

import { identityForRole } from "@/lib/users/twilio-identity";

describe("identityForRole", () => {
  it("gives AGENT an identity", () => {
    expect(identityForRole("AGENT", "00000000-0000-0000-0000-0000000000b3")).toBe(
      "lc_000000000000000000000000000000b3",
    );
  });

  it("gives ADMIN an identity", () => {
    expect(identityForRole("ADMIN", "11111111-1111-1111-1111-111111111111")).toBe(
      "lc_11111111111111111111111111111111",
    );
  });

  it("gives OWNER no identity (null)", () => {
    expect(identityForRole("OWNER", "22222222-2222-2222-2222-222222222222")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/lib/users/twilio-identity.test.ts`
Expected: FAIL — cannot resolve `@/lib/users/twilio-identity`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/portal/lib/users/twilio-identity.ts`:
```ts
import type { Role } from "@lc/shared";

import { toTwilioIdentity } from "@/lib/voice/identity";

/**
 * Call-takers (AGENT, ADMIN) get a deterministic Twilio identity at creation.
 * OWNER never takes calls, so it gets null (encodes "cannot receive calls").
 */
export function identityForRole(role: Role, userId: string): string | null {
  if (role === "OWNER") return null;
  return toTwilioIdentity(userId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/lib/users/twilio-identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `invite.ts` to use the shared helper**

In `apps/portal/lib/users/invite.ts`:

Add the import (below the existing `@lc/shared` import):
```ts
import { identityForRole } from "@/lib/users/twilio-identity";
```

Delete the local helper (lines ~22–25):
```ts
function twilioIdentityFor(role: Role, userId: string): string | null {
  if (role === "OWNER") return null;
  return `user-${userId.slice(0, 8)}`;
}
```

In the profile insert, change:
```ts
    twilio_identity: twilioIdentityFor(args.input.role, newUserId),
```
to:
```ts
    twilio_identity: identityForRole(args.input.role, newUserId),
```

(`Role` is still imported and used by `InviteInput`, so leave that import.)

- [ ] **Step 6: Refactor `updateUserAction` to use the shared helper**

In `apps/portal/app/(admin)/admin/users/actions.ts`:

Add the import near the other `@/lib/users` imports:
```ts
import { identityForRole } from "@/lib/users/twilio-identity";
```

In the role-change branch, change:
```ts
      updates.twilio_identity = `user-${target.id.slice(0, 8)}`;
```
to:
```ts
      updates.twilio_identity = identityForRole(patch.role, target.id);
```
(`ProfileUpdates.twilio_identity` is already typed `string | null`, so the union return type fits. Keep the surrounding `target.twilio_identity === null && (patch.role === "AGENT" || patch.role === "ADMIN")` guard unchanged.)

- [ ] **Step 7: Update the existing invite test to the new format**

The happy-path test in `apps/portal/tests/lib/users/invite.test.ts` stubs the new user's id as `"user-new"` (not a UUID) and currently asserts the old truncated format. Change (inside the `insert` `objectContaining` for the "happy path" test):
```ts
        twilio_identity: "user-user-new".slice(0, 13),
```
to:
```ts
        twilio_identity: "lc_usernew",
```
Rationale: `toTwilioIdentity("user-new")` = `"lc_"` + `"user-new"` with dashes removed = `"lc_usernew"`. The OWNER test's `twilio_identity: null` assertion stays unchanged.

- [ ] **Step 8: Verify nothing broke**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all PASS — including the updated `invite.test.ts` and the new `twilio-identity.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/portal/lib/users/twilio-identity.ts apps/portal/tests/lib/users/twilio-identity.test.ts apps/portal/lib/users/invite.ts "apps/portal/app/(admin)/admin/users/actions.ts" apps/portal/tests/lib/users/invite.test.ts
git commit -m "refactor(voice): single twilio_identity helper in lc_<uuid> format"
```

---

## Task 8: Seed `twilio_identity` for seeded call-takers

**Files:**
- Modify: `supabase/seed.sql` (after the `profiles` insert block)

- [ ] **Step 1: Add the identity backfill to the seed**

In `supabase/seed.sql`, immediately after the `insert into profiles (...) ... on conflict (id) do nothing;` block, add:
```sql
-- ── Twilio identities ───────────────────────────────────────────────────────
-- Call-takers (AGENT/ADMIN) get a deterministic identity so a local call can
-- dial them. OWNER stays null. Mirrors lib/voice/identity.ts (lc_<uuid-no-dashes>).
update profiles
   set twilio_identity = 'lc_' || replace(id::text, '-', '')
 where role in ('ADMIN', 'AGENT')
   and twilio_identity is null;
```

- [ ] **Step 2: Reset the local DB and verify**

Run (from repo root):
```bash
supabase db reset
```
Then verify:
```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "select full_name, role, twilio_identity from profiles order by role;"
```
Expected: the ADMIN row and both AGENT rows have `lc_…` identities; the OWNER row's `twilio_identity` is null.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(voice): seed twilio_identity for seeded call-takers"
```

---

## Task 9: `/api/twilio/voice/incoming` route

**Files:**
- Create: `apps/portal/app/api/twilio/voice/incoming/route.ts`
- Test: `apps/portal/tests/app/twilio/incoming.test.ts`

The route test mocks the service-role client and the signature verifier, so it runs with no DB. A small mock helper returns canned query results per table.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/twilio/incoming.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// --- mocks -----------------------------------------------------------------
const validateTwilioSignature = vi.fn();
const publicUrlFromRequest = vi.fn(
  () => "https://abc.trycloudflare.com/api/twilio/voice/incoming",
);
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: (...a: unknown[]) => validateTwilioSignature(...a),
  publicUrlFromRequest: (...a: unknown[]) => publicUrlFromRequest(...a),
}));

// Per-table canned responses, settable per test.
type Canned = {
  property?: unknown;
  existingCall?: unknown;
  assignment?: unknown;
  agent?: unknown;
  availRows?: unknown[];
  admins?: unknown[];
};
let canned: Canned = {};
const insertSpy = vi.fn(() => Promise.resolve({ error: null }));

function makeAdminClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.is = chain;
      builder.insert = (row: unknown) => insertSpy(table, row);
      builder.maybeSingle = () => {
        if (table === "properties") return Promise.resolve({ data: canned.property ?? null });
        if (table === "calls") return Promise.resolve({ data: canned.existingCall ?? null });
        if (table === "property_assignments") return Promise.resolve({ data: canned.assignment ?? null });
        if (table === "profiles") return Promise.resolve({ data: canned.agent ?? null });
        return Promise.resolve({ data: null });
      };
      // admin_call_availability .select().eq().eq() resolves as a thenable list;
      // profiles admin lookup uses .in().eq()... then awaited as a list.
      builder.then = (resolve: (v: unknown) => void) => {
        if (table === "admin_call_availability") return resolve({ data: canned.availRows ?? [] });
        if (table === "profiles") return resolve({ data: canned.admins ?? [] });
        return resolve({ data: [] });
      };
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/incoming/route";

function makeRequest(params: Record<string, string>) {
  const body = new URLSearchParams(params);
  return new Request("http://localhost:3000/api/twilio/voice/incoming", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "sig",
    },
    body,
  });
}

beforeEach(() => {
  canned = {};
  insertSpy.mockClear();
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/incoming", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    expect(res.status).toBe(403);
  });

  it("returns not-in-service apology when the property is unknown", async () => {
    canned.property = null;
    const res = await POST(makeRequest({ To: "+19999999999", From: "+2", CallSid: "CA1" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("dials the assigned agent and inserts a RINGING call", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true };
    canned.assignment = { primary_agent_id: "a1" };
    canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    const xml = await res.text();
    expect(xml).toContain("<Client>lc_a1</Client>");
    expect(xml).toContain('action="https://abc.trycloudflare.com/api/twilio/voice/dial-result"');
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row).toMatchObject({
      property_id: "p1",
      operator_id: "op1",
      channel: "AUDIO",
      state: "RINGING",
      twilio_call_sid: "CA1",
      caller_number: "+2",
    });
  });

  it("plays apology + records NO_ANSWER when nobody is reachable", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true };
    canned.assignment = null;
    canned.availRows = [];
    const res = await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA2" }));
    const xml = await res.text();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(row).toMatchObject({ state: "NO_ANSWER" });
  });

  it("is idempotent — an existing call for the CallSid is not re-inserted", async () => {
    canned.property = { id: "p1", operator_id: "op1", active: true };
    canned.assignment = { primary_agent_id: "a1" };
    canned.agent = { id: "a1", twilio_identity: "lc_a1", active: true };
    canned.existingCall = { id: "call1" };
    await POST(makeRequest({ To: "+1", From: "+2", CallSid: "CA1" }));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
```

> **Note on the mock:** the chain builder returns itself for `select/eq/in/is`, resolves single-row reads via `maybeSingle`, and resolves list reads (admins, availability) via a `then` thenable. This matches the exact call shapes used in the route below. If you change the route's query chain, update the mock to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/twilio/incoming.test.ts`
Expected: FAIL — cannot resolve `@/app/api/twilio/voice/incoming/route`.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/twilio/voice/incoming/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { planDial, type DialCandidate } from "@/lib/voice/plan-dial";
import { buildIncomingTwiml, buildNotInServiceTwiml } from "@/lib/voice/twiml";

export const runtime = "nodejs";

const GREETING = "Connecting you to the front desk, one moment.";
const APOLOGY =
  "We're sorry, no one is available right now. Please try again or call us directly.";
const RING_TIMEOUT_SECONDS = 120;

function twimlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const signature = request.headers.get("x-twilio-signature");
  const url = publicUrlFromRequest(request);
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const to = params.To ?? "";
  const from = params.From ?? "";
  const callSid = params.CallSid ?? "";

  const admin = createAdminClient();

  // 1. Property by routing_did (active only).
  const { data: property } = await admin
    .from("properties")
    .select("id, operator_id, active")
    .eq("routing_did", to)
    .maybeSingle();

  if (!property || !property.active) {
    return twimlResponse(buildNotInServiceTwiml(APOLOGY));
  }

  // 2. Idempotency: has this CallSid already been recorded?
  const { data: existing } = await admin
    .from("calls")
    .select("id")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  // 3. Active primary agent (effective_until is null).
  const { data: assignment } = await admin
    .from("property_assignments")
    .select("primary_agent_id")
    .eq("property_id", property.id)
    .is("effective_until", null)
    .maybeSingle();

  let primaryAgent: DialCandidate | null = null;
  if (assignment?.primary_agent_id) {
    const { data: agent } = await admin
      .from("profiles")
      .select("id, twilio_identity, active")
      .eq("id", assignment.primary_agent_id)
      .maybeSingle();
    if (agent?.active && agent.twilio_identity) {
      primaryAgent = { id: agent.id, twilioIdentity: agent.twilio_identity };
    }
  }

  // 4. Admins accepting calls for this property.
  const { data: availRows } = await admin
    .from("admin_call_availability")
    .select("profile_id")
    .eq("property_id", property.id)
    .eq("accepting_calls", true);

  const availableAdmins: DialCandidate[] = [];
  const availIds = (availRows ?? []).map(
    (r: { profile_id: string }) => r.profile_id,
  );
  if (availIds.length > 0) {
    const { data: admins } = await admin
      .from("profiles")
      .select("id, twilio_identity, active, role, operator_id")
      .in("id", availIds)
      .eq("active", true)
      .eq("role", "ADMIN")
      .eq("operator_id", property.operator_id);
    for (const a of (admins ?? []) as Array<{
      id: string;
      twilio_identity: string | null;
    }>) {
      if (a.twilio_identity) {
        availableAdmins.push({ id: a.id, twilioIdentity: a.twilio_identity });
      }
    }
  }

  const targets = planDial({ primaryAgent, availableAdmins });

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

  // 6. Return TwiML (apology if nobody reachable, else parallel dial).
  const actionUrl = `${new URL(url).origin}/api/twilio/voice/dial-result`;
  return twimlResponse(
    buildIncomingTwiml(targets, {
      greeting: GREETING,
      timeoutSeconds: RING_TIMEOUT_SECONDS,
      actionUrl,
      apologyMessage: APOLOGY,
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/twilio/incoming.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/twilio/voice/incoming/route.ts" apps/portal/tests/app/twilio/incoming.test.ts
git commit -m "feat(voice): /incoming webhook — parallel-dial TwiML + calls insert"
```

---

## Task 10: `/api/twilio/voice/dial-result` route

**Files:**
- Create: `apps/portal/app/api/twilio/voice/dial-result/route.ts`
- Test: `apps/portal/tests/app/twilio/dial-result.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/twilio/dial-result.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn();
const publicUrlFromRequest = vi.fn(
  () => "https://abc.trycloudflare.com/api/twilio/voice/dial-result",
);
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: (...a: unknown[]) => validateTwilioSignature(...a),
  publicUrlFromRequest: (...a: unknown[]) => publicUrlFromRequest(...a),
}));

const updateSpy = vi.fn(() => Promise.resolve({ error: null }));
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.update = (vals: unknown) => {
        updateSpy(vals);
        return builder;
      };
      builder.eq = () => builder;
      builder.then = (resolve: (v: unknown) => void) => resolve({ error: null });
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/dial-result/route";

function makeRequest(params: Record<string, string>) {
  return new Request("http://localhost:3000/api/twilio/voice/dial-result", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "sig",
    },
    body: new URLSearchParams(params),
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/dial-result", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(makeRequest({ CallSid: "CA1", DialCallStatus: "completed" }));
    expect(res.status).toBe(403);
  });

  it("answered call → Hangup + COMPLETED", async () => {
    const res = await POST(
      makeRequest({ CallSid: "CA1", DialCallStatus: "completed" }),
    );
    const xml = await res.text();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED" }),
    );
  });

  it("unanswered call → apology + NO_ANSWER", async () => {
    const res = await POST(
      makeRequest({ CallSid: "CA1", DialCallStatus: "no-answer" }),
    );
    const xml = await res.text();
    expect(xml).toContain("<Say>");
    expect(xml).toContain("<Hangup/>");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "NO_ANSWER" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/twilio/dial-result.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/twilio/voice/dial-result/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import { buildApologyTwiml, buildHangupTwiml } from "@/lib/voice/twiml";
import { resolveDialResult } from "@/lib/voice/result";

export const runtime = "nodejs";

const APOLOGY =
  "We're sorry, no one is available right now. Please try again or call us directly.";

function twimlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const signature = request.headers.get("x-twilio-signature");
  const url = publicUrlFromRequest(request);
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const callSid = params.CallSid ?? "";
  const { finalState, hangup } = resolveDialResult(params.DialCallStatus ?? "");

  const admin = createAdminClient();
  await admin
    .from("calls")
    .update({ state: finalState, ended_at: new Date().toISOString() })
    .eq("twilio_call_sid", callSid);

  return twimlResponse(hangup ? buildHangupTwiml() : buildApologyTwiml(APOLOGY));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/twilio/dial-result.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/twilio/voice/dial-result/route.ts" apps/portal/tests/app/twilio/dial-result.test.ts
git commit -m "feat(voice): /dial-result webhook — finalize answered/timeout"
```

---

## Task 11: `/api/twilio/voice/status` route

**Files:**
- Create: `apps/portal/app/api/twilio/voice/status/route.ts`
- Test: `apps/portal/tests/app/twilio/status.test.ts`

The status callback is the authoritative finalizer for `duration`/`ended_at` and FAILED, but must **not** overwrite a terminal state already set by `/dial-result`. The route fetches the current state and skips the state change if already terminal.

- [ ] **Step 1: Write the failing test**

Create `apps/portal/tests/app/twilio/status.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const validateTwilioSignature = vi.fn();
const publicUrlFromRequest = vi.fn(
  () => "https://abc.trycloudflare.com/api/twilio/voice/status",
);
vi.mock("@/lib/twilio/client", () => ({
  validateTwilioSignature: (...a: unknown[]) => validateTwilioSignature(...a),
  publicUrlFromRequest: (...a: unknown[]) => publicUrlFromRequest(...a),
}));

let currentState: string | null = "RINGING";
const updateSpy = vi.fn(() => Promise.resolve({ error: null }));
function makeAdminClient() {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: currentState ? { state: currentState } : null });
      builder.update = (vals: unknown) => {
        updateSpy(vals);
        return builder;
      };
      return builder;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

import { POST } from "@/app/api/twilio/voice/status/route";

function makeRequest(params: Record<string, string>) {
  return new Request("http://localhost:3000/api/twilio/voice/status", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "sig",
    },
    body: new URLSearchParams(params),
  });
}

beforeEach(() => {
  updateSpy.mockClear();
  currentState = "RINGING";
  validateTwilioSignature.mockReturnValue(true);
});

describe("POST /api/twilio/voice/status", () => {
  it("rejects an invalid signature with 403", async () => {
    validateTwilioSignature.mockReturnValue(false);
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(403);
  });

  it("finalizes a non-terminal call with state + duration", async () => {
    currentState = "RINGING";
    const res = await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }),
    );
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ state: "COMPLETED", duration_seconds: 30 }),
    );
  });

  it("does not overwrite an already-terminal state but still records duration", async () => {
    currentState = "NO_ANSWER";
    await POST(
      makeRequest({ CallSid: "CA1", CallStatus: "completed", CallDuration: "5" }),
    );
    const vals = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(vals).not.toHaveProperty("state");
    expect(vals).toMatchObject({ duration_seconds: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/app/twilio/status.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write the route**

Create `apps/portal/app/api/twilio/voice/status/route.ts`:
```ts
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateTwilioSignature,
  publicUrlFromRequest,
} from "@/lib/twilio/client";
import {
  mapFinalCallState,
  isTerminalState,
  parseDurationSeconds,
  type CallState,
} from "@/lib/voice/result";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  const signature = request.headers.get("x-twilio-signature");
  const url = publicUrlFromRequest(request);
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const callSid = params.CallSid ?? "";
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("calls")
    .select("state")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  const duration = parseDurationSeconds(params.CallDuration);
  const mapped = mapFinalCallState(params.CallStatus ?? "");

  const updates: {
    ended_at: string;
    duration_seconds?: number;
    state?: CallState;
  } = { ended_at: new Date().toISOString() };

  if (duration !== null) updates.duration_seconds = duration;

  // Only set state if we have a terminal mapping AND the row isn't already terminal.
  const currentTerminal = existing
    ? isTerminalState(existing.state as CallState)
    : false;
  if (mapped && !currentTerminal) updates.state = mapped;

  await admin.from("calls").update(updates).eq("twilio_call_sid", callSid);

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/app/twilio/status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/portal/app/api/twilio/voice/status/route.ts" apps/portal/tests/app/twilio/status.test.ts
git commit -m "feat(voice): /status webhook — finalize duration + state guard"
```

---

## Task 12: Full suite + gates

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite + all gates**

Run (from `apps/portal/`):
```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```
Expected: all green. Test count = prior 55 + the new voice/twilio/users + route tests.

- [ ] **Step 2: Fix any failures, then re-run until clean.**

---

## Task 13: Live smoke test (manual, with Kumar)

**Prereq:** Kumar has completed `docs/setup/2026-05-30-twilio-voice-setup.md` Sections 1–4 + 6 (account upgraded, local number bought, five env vars in `apps/portal/.env.local`). `cloudflared` installed (`brew install cloudflared`).

- [ ] **Step 1: Start local stack + dev server**

```bash
supabase start              # if not already running
supabase db reset           # ensures seeded identities are present
cd apps/portal && pnpm dev  # http://localhost:3000
```

- [ ] **Step 2: Start the tunnel**

In a second terminal:
```bash
cloudflared tunnel --url http://localhost:3000
```
Copy the printed `https://<random>.trycloudflare.com` URL.

- [ ] **Step 3: Point the Twilio number's webhooks at the tunnel**

In the Twilio Console → Phone Numbers → the local number → Voice configuration:
- "A call comes in": **HTTP POST** → `https://<tunnel>/api/twilio/voice/incoming`
- "Call status changes": **HTTP POST** → `https://<tunnel>/api/twilio/voice/status`
Save.

- [ ] **Step 4: Place a real call**

Call the local number from a phone. Because no softphone is registered yet (that's 5b), expect: greeting → ~120s ringback → apology → hangup.

- [ ] **Step 5: Verify the `calls` row**

```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "select state, caller_number, twilio_call_sid, ring_started_at, ended_at, duration_seconds \
   from calls order by created_at desc limit 1;"
```
Expected: one AUDIO row, `state = NO_ANSWER` (the seeded agents have identities but no registered Device, so the dial times out), correct `caller_number` and `twilio_call_sid`, `ended_at` populated.

- [ ] **Step 6: Verify idempotency**

Confirm only **one** `calls` row exists for that `twilio_call_sid` (Twilio may retry the webhook):
```bash
docker exec supabase_db_lobby-connect psql -U postgres -c \
  "select twilio_call_sid, count(*) from calls group by twilio_call_sid having count(*) > 1;"
```
Expected: zero rows returned.

- [ ] **Step 7: (Optional) Inspect generated TwiML**

In Twilio Console → Monitor → Logs → Calls → the call → request inspector. Confirm the returned TwiML lists the expected `<Client>lc_…</Client>` identities and `timeout="120"`.

---

## Task 14: Tag the milestone

**Files:** none

- [ ] **Step 1: Confirm clean tree + tag**

Run (from repo root):
```bash
git status            # clean
git tag plan-05a-voice-backend-complete
git tag -n1 | grep 05a
```
Per the standing policy, **do not push** — migrations 0001–0005 are local-only and the repo stays unpushed. (5a adds no migration.)

- [ ] **Step 2: Update project status memory**

Note for the session wrap-up: update `project-status.md` to record 5a complete, tag name, and that 5b (agent dashboard softphone + token route) is next.

---

## Self-Review Notes (author)

- **Spec coverage:** identity (T2), dial dedup (T3), TwiML incl. empty→apology + not-in-service seam (T4), lifecycle finalize/idempotency (T9–T11), `twilio_identity` consolidation onto `lc_<uuid>` + seed + OWNER-null guard (T7–T8), HMAC verify (T6), env/config + provisioning + tunnel + smoke (T1, T13), Node runtime + service-role in every route (T9–T11), no recording / token-route-deferred (out of scope, not built). All spec sections map to a task.
- **Pre-existing code discovered during planning:** `twilio_identity` was already set in `invite.ts` and `updateUserAction` using a collision-prone `user-<first8>` format. T7 consolidates both onto the spec's `lc_<uuid-without-dashes>` format via one shared helper and updates the existing `invite.test.ts`. The `profiles` table also still carries the legacy global `accepting_calls` column (superseded by `admin_call_availability` in 4c) — 5a does not read or touch it.
- **No new migration** (spec §10) — confirmed; only `seed.sql` data changes.
- **Type consistency:** `DialCandidate`/`DialTarget`/`DialInput` (T3) reused in T4/T9; `CallState` (T5) reused in T11; `identityForRole` (T7) wraps `toTwilioIdentity` (T2). Names consistent across tasks.
- **Mock caveat:** the route tests stub the Supabase chain by shape; if a route's query chain changes, its test mock must change with it (noted in T9).
